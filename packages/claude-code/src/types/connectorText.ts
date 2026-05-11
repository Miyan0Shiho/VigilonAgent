/**
 * Stub for missing connector text types
 */
export type ConnectorText = string;

export function isConnectorTextBlock(x: any): boolean {
  return false;
}

export type ConnectorTextBlock = {
  type: 'text';
  text: string;
};
