import { win32 } from "node:path";

// cmd escaping adapted from cross-spawn's lib/util/escape.js and lib/parse.js.
// https://github.com/moxystudio/node-cross-spawn
// The MIT License (MIT)
// Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
const metaCharacters = /([()\][%!^"`<>&|;, *?])/g;
const escapeMeta = (value) => value.replace(metaCharacters, "^$1");
const escapeArgument = (value, doubleEscape) => {
  let result = String(value)
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, "$1$1");
  result = escapeMeta(`"${result}"`);
  return doubleEscape ? escapeMeta(result) : result;
};

export const learningCommandInvocation = (command, args, platform = process.platform, env = process.env) => {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args, windowsVerbatimArguments: false };
  }
  // Prompts stay on stdin. Reject characters that cannot safely form a cmd
  // command line; only executable paths and bounded static options go here.
  if ([command, ...args].some((value) => /[\0\r\n]/u.test(String(value)))) {
    throw new Error("Invalid Windows CLI argument");
  }
  // CLI batch shims forward through %*, which parses the arguments again.
  // Global npm installs and explicit wrappers need the same protection as
  // node_modules/.bin; their directory name does not change cmd semantics.
  const doubleEscape = true;
  const shellCommand = [escapeMeta(win32.normalize(command)), ...args.map((value) => escapeArgument(value, doubleEscape))].join(" ");
  if (shellCommand.length > 8000) throw new Error("Windows CLI arguments exceed the command limit");
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
  return {
    command: systemRoot ? win32.join(systemRoot, "System32", "cmd.exe") : "cmd.exe",
    args: ["/d", "/s", "/v:off", "/c", `"${shellCommand}"`],
    windowsVerbatimArguments: true,
  };
};
