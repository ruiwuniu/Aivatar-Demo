export type GameConsoleSpriteId = "game-console-c";

export interface GameConsoleSpriteDefinition {
  xOffset: number;
  yOffset: number;
  width: number;
  height: number;
  palette: Record<string, string>;
  rows: readonly string[];
}

export const GAME_CONSOLE_SCREEN_REGION = {
  x: 16,
  y: 5,
  width: 21,
  height: 13,
} as const;

// Visual-only game console sprite extracted from the approved C reference.
export const GAME_CONSOLE_SPRITE_DATA: Record<GameConsoleSpriteId, GameConsoleSpriteDefinition> = {
  "game-console-c": {
    xOffset: -25,
    yOffset: -17,
    width: 50,
    height: 23,
    palette: {
      '0': '#13191f',
      '1': '#1d1e24',
      '2': '#0e151c',
      '3': '#0f181e',
      '4': '#11181f',
      '5': '#101218',
      '6': '#1a1b20',
      '7': '#27242b',
      '8': '#313238',
      '9': '#1f2124',
      'A': '#1d282b',
      'B': '#0b1016',
      'C': '#364846',
      'D': '#cac3b0',
      'E': '#f2e6d2',
      'F': '#8a8e7d',
      'G': '#5d6a65',
      'H': '#5fbdb8',
      'I': '#4b9892',
      'J': '#343a40',
      'K': '#e4d7c3',
      'L': '#31615f',
      'M': '#0f0f14',
      'N': '#000000',
      'O': '#6faba3',
      'P': '#000001',
      'Q': '#090b0e',
      'R': '#040406',
    },
    rows: [
      '..................................................',
      '..1257888889505504504555555550000000550AAAAAA251..',
      '..CKEKKKEEEF1J8888888888888JJJ888JJ8J7LHIIHHHHH8..',
      '.BFEKKKDFGDF675555555MMM5MMMMM55MM5577LIJJIHHIHIB.',
      '.9DKKKEKFFKF19NNNNNNQQQQQNNNNNNNNNNN97LHCLIHHHHO0.',
      '.9DEDJ88GKEF17NQQ23332QQQQQ522B22QQN97LHHHL8LHHI0.',
      '.9DEG8CC7FEF17NQQ245242QQQ23430242BN77LHHHCM8HHI0.',
      '.9DEC9880FEF17NQQ24C123QQQ20BLOJB05N97LHILICILGI0.',
      '.9DED7MRGKEF17NQQ222242QQQ428CCCA2BN77LHCAIIIACI0.',
      '.9DKKDDDKKEF17NQQ243232343345BBB24BN97LHHHL8LHHI4.',
      '.9DKKKEEKKEF17NQ425432343033060632MN97LHIHCMJHHI3.',
      '.9DKKKDDKKEF67NQ26A20BAGFGAB042343BN97LHIHILIHHI4.',
      '.9DKDF7JDDEF17NQ34240BAGLIJQA021A2BN97LHHILLLIHI4.',
      '.1DF8867JCKF17NB4B258ARLOGQ08BB2222N97LHIJ8C8LHI4.',
      '.9DFM7J867KF17NB28GLGGCGGGLLGCCLJ05N97LHI7CJJAII3.',
      '.9DKEDQ8KKEF17N524A0AA0A1AAA1A0A452N97LHI567MAHI3.',
      '.9DKKKFDKKEF17NB3252BB5B5BB5BB5B23BN97LHHIA1AIHI3.',
      '.9DKKKEEEEEF17PB420300004004004022BP77LHHHHOHHHI3.',
      '.6FKKKKFCGKF6J999999999999999999999789LHLJLIIHIL3.',
      '..CDKKKEEEEF1JJJJJJJJJJJJJJJJJJJJJJJJ9LHHHHHHII8..',
      '..6GFDDDDDDF57111111111111111166111695CIIIIIILC2..',
      '..2BR5666665QQQQQQQQQQQQQQQQQQQQQQQQQQQBBBBBBQB2..',
      '..................................................',
    ],
  },
};
