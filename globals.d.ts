declare module "*.jpg" {
  const src: string
  export default src
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.svg" {
  const src: string
  export default src
}

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined
  }
}

declare const process: {
  env: NodeJS.ProcessEnv
}
