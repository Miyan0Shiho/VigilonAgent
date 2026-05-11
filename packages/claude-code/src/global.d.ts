declare global {
  /**
   * Mock for build-time MACRO injection
   */
  const MACRO: {
    VERSION: string;
    IS_LOCAL: boolean;
    [key: string]: any;
  };

  /**
   * Mock for Anthropic internal model resolver
   */
  function resolveAntModel(model: string): string;
}

export {};
