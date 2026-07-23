export interface ProfileRequestToken {
  userId: string;
  generation: number;
}

interface ProfileRequestState {
  latestIssuedGeneration: number;
}

export class ProfileRequestCoordinator {
  private readonly requests = new Map<string, ProfileRequestState>();

  begin(userId: string): ProfileRequestToken {
    const state = this.requests.get(userId) ?? {
      latestIssuedGeneration: 0,
    };
    state.latestIssuedGeneration += 1;
    this.requests.set(userId, state);
    return { userId, generation: state.latestIssuedGeneration };
  }

  acceptSuccess(token: ProfileRequestToken): boolean {
    const state = this.requests.get(token.userId);
    return state?.latestIssuedGeneration === token.generation;
  }

  isCurrent(token: ProfileRequestToken): boolean {
    return (
      this.requests.get(token.userId)?.latestIssuedGeneration ===
      token.generation
    );
  }
}
