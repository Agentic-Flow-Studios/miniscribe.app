declare module '*.svg' {
  import React from 'react';
  const FC: React.FC<React.SVGProps<SVGSVGElement>>;
  export default FC;
}

declare module '*.css';

declare namespace NodeJS {
  interface ProcessEnv {
    APP_VERSION?: string;
  }
}

