// Aivatar additions to tauri-plugin-updater 2.12.0.
// SPDX-License-Identifier: Apache-2.0 OR MIT
use futures_util::StreamExt;
use reqwest::{redirect::Policy, ClientBuilder, Response};
use url::Url;

use crate::{Error, Result};

/// Optional hard network bounds. Both the initial URL and every redirect must
/// remain on an exact allowed HTTPS host. No URL credentials or alternate ports.
#[derive(Clone, Debug)]
pub struct NetworkLimits {
    pub max_manifest_bytes: usize,
    pub max_download_bytes: usize,
    pub allowed_hosts: Vec<String>,
    pub max_redirects: usize,
}

impl NetworkLimits {
    pub(crate) fn allows(&self, url: &Url) -> bool {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url
                .host_str()
                .is_some_and(|host| self.allowed_hosts.iter().any(|allowed| allowed == host))
    }

    pub(crate) fn client(&self, client: ClientBuilder, initial_url: &Url) -> Result<ClientBuilder> {
        if !self.allows(initial_url) {
            return Err(Error::Network(
                "The updater URL is outside the allowed HTTPS hosts.".into(),
            ));
        }
        let limits = self.clone();
        Ok(client
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .redirect(Policy::custom(move |attempt| {
                if attempt.previous().len() > limits.max_redirects {
                    attempt.error("The updater redirect limit was exceeded.")
                } else if !limits.allows(attempt.url()) {
                    attempt.error("The updater redirected outside the allowed HTTPS hosts.")
                } else {
                    attempt.follow()
                }
            })))
    }
}

/// Never trust Content-Length as the only bound: enforce the same limit before
/// appending every streamed chunk, including chunked and close-delimited bodies.
pub(crate) async fn read_bounded<C: FnMut(usize, Option<u64>)>(
    response: Response,
    limit: usize,
    mut on_chunk: C,
) -> Result<Vec<u8>> {
    let length = response.content_length();
    if length.is_some_and(|length| length > limit as u64) {
        return Err(Error::Network(
            "The updater response exceeds its size limit.".into(),
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let new_length = bytes
            .len()
            .checked_add(chunk.len())
            .filter(|new_length| *new_length <= limit)
            .ok_or_else(|| Error::Network("The updater response exceeds its size limit.".into()))?;
        // Avoid Vec's doubling growth allocating substantially beyond the cap.
        bytes
            .try_reserve_exact(new_length - bytes.len())
            .map_err(|_| {
                Error::Network("Could not allocate the bounded updater response.".into())
            })?;
        bytes.extend_from_slice(&chunk);
        on_chunk(chunk.len(), length);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    fn fetch(response: &'static [u8], limit: usize) -> Result<Vec<u8>> {
        #[cfg(feature = "rustls-tls")]
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let _ = stream.write_all(response);
        });
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                // The local HTTP fixture is test-only; production NetworkLimits
                // rejects HTTP before creating any request.
                let response = reqwest::Client::builder()
                    .no_proxy()
                    .timeout(Duration::from_secs(3))
                    .build()
                    .unwrap()
                    .get(format!("http://{address}/fixture"))
                    .send()
                    .await
                    .unwrap();
                read_bounded(response, limit, |_, _| {}).await
            });
        server.join().unwrap();
        result
    }

    #[test]
    fn accepts_exact_boundary_and_empty_body() {
        assert_eq!(
            fetch(
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n1234",
                4
            )
            .unwrap(),
            b"1234"
        );
        assert!(fetch(
            b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            0
        )
        .unwrap()
        .is_empty());
    }

    #[test]
    fn rejects_oversized_declared_unknown_and_chunked_bodies() {
        for response in [
            &b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n12345"[..],
            &b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n12345"[..],
            &b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n12\r\n3\r\n345\r\n0\r\n\r\n"[..],
        ] {
            assert!(matches!(fetch(response, 4), Err(Error::Network(_))));
        }
    }

    #[test]
    fn accepts_chunked_boundary_and_rejects_truncated_length() {
        assert_eq!(fetch(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n12\r\n2\r\n34\r\n0\r\n\r\n", 4).unwrap(), b"1234");
        assert!(fetch(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n12",
            4
        )
        .is_err());
        assert!(fetch(
            b"HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n12",
            4
        )
        .is_err());
    }

    #[test]
    fn permits_only_exact_https_hosts_without_credentials_or_ports() {
        let limits = NetworkLimits {
            max_manifest_bytes: 10,
            max_download_bytes: 10,
            allowed_hosts: vec![
                "github.com".into(),
                "release-assets.githubusercontent.com".into(),
            ],
            max_redirects: 5,
        };
        for url in ["https://github.com/owner/repo", "https://release-assets.githubusercontent.com/github-production-release-asset/1/file?token=test"] {
            assert!(limits.allows(&url.parse().unwrap()));
        }
        for url in [
            "http://github.com/a",
            "https://github.com.evil.invalid/a",
            "https://user@github.com/a",
            "https://github.com:8443/a",
            "https://127.0.0.1/a",
            "https://objects.githubusercontent.com/a",
        ] {
            assert!(!limits.allows(&url.parse().unwrap()));
        }
    }

    #[test]
    fn streamed_limit_preserves_accepted_progress_and_rejects_the_next_chunk() {
        #[cfg(feature = "rustls-tls")]
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (progress_sent, progress_received) = std::sync::mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0_u8; 2048];
            stream.read(&mut request).unwrap();
            stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\n12\r\n").unwrap();
            stream.flush().unwrap();
            // The server cannot send the oversize chunk until the bounded
            // reader has accepted and reported the first network chunk.
            progress_received
                .recv_timeout(Duration::from_secs(3))
                .unwrap();
            stream.write_all(b"3\r\n345\r\n0\r\n\r\n").unwrap();
        });
        let mut progress = Vec::new();
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let response = reqwest::Client::builder()
                    .no_proxy()
                    .timeout(Duration::from_secs(3))
                    .build()
                    .unwrap()
                    .get(format!("http://{address}/fixture"))
                    .send()
                    .await
                    .unwrap();
                read_bounded(response, 4, |chunk, total| {
                    assert_eq!(total, None);
                    progress.push(chunk);
                    progress_sent.send(()).unwrap();
                })
                .await
            });
        server.join().unwrap();
        assert!(matches!(result, Err(Error::Network(_))));
        assert_eq!(
            progress,
            [2],
            "Rejected bytes must never be reported as downloaded"
        );
    }
}
