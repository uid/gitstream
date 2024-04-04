declare const settings: {
  omnivoreEndpointsForExercise: (exerciseName: string) => Array<{
    url: string;
    key: string;
  }>;
  openid: {
    serverUrl: string;
    clientId: string;
    clientSecret: string;
    clientUrl: string;
    usernameFromEmail: (email: string) => string;
    clockTolerance: number;
  };
  sessionSecret: string;
  reposPath: string;
};

export default settings;
