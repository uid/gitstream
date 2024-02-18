declare module 'git-angler' {
  const gitHttpBackend: any;
  const githookEndpoint: any;
  const EventBus: any;

  const angler: {
    gitHttpBackend: typeof gitHttpBackend;
    githookEndpoint: typeof githookEndpoint;
    EventBus: typeof EventBus;
  };

  export default angler;
}
