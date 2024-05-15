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
  // note: there may be issues if these are not absolute
  reposPath: string; // The filepath where all user repos will live
  pemPath: string;
};

export default settings;
