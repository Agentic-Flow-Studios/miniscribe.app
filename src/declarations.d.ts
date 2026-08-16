declare module '*.svg' {
  import React from 'react';
  const FC: React.FC<React.SVGProps<SVGSVGElement>>;
  export default FC;
}

declare namespace NodeJS {
  interface ProcessEnv {
    APP_VERSION?: string;
  }
}
