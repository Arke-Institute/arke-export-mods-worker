/**
 * Callback handler - sends results back to orchestrator
 */

export interface SuccessCallback {
  task_id: string;
  batch_id: string;
  status: 'success';
  output_r2_key: string;
  output_file_name: string;
  output_file_size: number;
  metrics: {
    total_time_ms: number;
    entities_exported: number;
    entities_failed: number;
    entities_incomplete: number;
    peak_memory_mb: number;
  };
}

export interface ErrorCallback {
  task_id: string;
  batch_id: string;
  status: 'error';
  error: string;
}

export type CallbackPayload = SuccessCallback | ErrorCallback;

/**
 * Send callback to orchestrator with export results
 */
export async function sendCallback(
  callbackUrl: string | undefined,
  payload: CallbackPayload
): Promise<void> {
  if (!callbackUrl) {
    console.log('[CALLBACK] No CALLBACK_URL provided, skipping callback');
    return;
  }

  console.log(`[CALLBACK] Sending to ${callbackUrl}...`);

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload, null, 2),
    });

    if (!response.ok) {
      console.error(
        `[CALLBACK] ✗ Failed: ${response.status} ${response.statusText}`
      );
      const text = await response.text().catch(() => '');
      if (text) {
        console.error(`[CALLBACK] Response: ${text}`);
      }
    } else {
      console.log(`[CALLBACK] ✓ Sent successfully`);
    }
  } catch (error) {
    console.error(
      `[CALLBACK] ✗ Failed to send: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    // Don't throw - callback failure shouldn't fail the task
  }
}
