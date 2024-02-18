declare module 'gitstream-exercises' {
  const machines: any;
  const viewers: any;
  const repos: any;

  const gitstreamExercises: {
    machines: typeof machines;
    viewers: typeof viewers;
    repos: typeof repos;
  };

  export default gitstreamExercises;
}