declare module "pokersolver" {
  export interface SolvedPokerHand {
    cardPool: unknown[];
    cards: unknown[];
    descr: string;
    name: string;
    rank: number;
    toString(): string;
  }

  export const Hand: {
    solve(cards: string[], game?: string, canDisqualify?: boolean): SolvedPokerHand;
    winners(hands: SolvedPokerHand[]): SolvedPokerHand[];
  };
}
