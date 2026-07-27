import { useContext } from 'react';
import { ArrayStatusContext, type ArrayStatusContextValue } from './ArrayStatusContext';

export function useArrayStatus(): ArrayStatusContextValue {
  const ctx = useContext(ArrayStatusContext);
  if (!ctx) throw new Error('useArrayStatus must be used within an ArrayStatusProvider');
  return ctx;
}
