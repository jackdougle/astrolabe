/// <reference types="vite/client" />
declare module 'monaco-editor/*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
