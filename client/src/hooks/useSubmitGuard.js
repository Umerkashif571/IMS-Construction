import { useState, useCallback } from 'react';

export function useSubmitGuard() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const guard = useCallback(async (submitFn) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await submitFn();
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting]);

  return { isSubmitting, guard };
}

export function useSubmitGuardMulti() {
  const [submittingKeys, setSubmittingKeys] = useState({});

  const guard = useCallback(async (key, submitFn) => {
    if (submittingKeys[key]) return;
    setSubmittingKeys(prev => ({ ...prev, [key]: true }));
    try {
      const result = await submitFn();
      return result;
    } finally {
      setSubmittingKeys(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, [submittingKeys]);

  const isSubmitting = (key) => !!submittingKeys[key];

  return { isSubmitting, guard };
}