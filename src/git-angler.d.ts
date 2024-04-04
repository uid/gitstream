declare module 'git-angler' {
  interface EventBus {
    _listeners: { [scope: string]: { [event: string]: { name: string, cb: Function }[] } };
    _handlers: { [scope: string]: { [event: string]: Function } };
    addListener(name: string, scope: string, event: string, cb: Function): void;
    setHandler(scope: string, event: string, cb: Function): Function | undefined;
    removeListener(name: string, scope: string, event: string): boolean;
    triggerHandler(scope: string, event: string, args: any[]): boolean;
    triggerListeners(scope: string, event: string, args: any[]): boolean;
    trigger(...args: any[]): boolean;
  }

  const gitHttpBackend: any;
  const githookEndpoint: any;
  const EventBus: new () => EventBus;

  const angler: {
    gitHttpBackend: typeof gitHttpBackend;
    githookEndpoint: typeof githookEndpoint;
    EventBus: typeof EventBus;
  };

  export default angler;
}
