import type {ContentResult} from 'fastmcp';

export function textResult(text: string): ContentResult {
  return {
    content: [{type: 'text', text}],
  };
}

export function errorResult(text: string): ContentResult {
  return {
    content: [{type: 'text', text}],
    isError: true,
  };
}
