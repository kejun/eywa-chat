type MetricPoint = {
  name: string;
  value: number;
  tags?: Record<string, string>;
  unit?: "count" | "ms";
  timestamp: string;
};

const MAX_POINTS = 1_000;

type GlobalMetricsCache = typeof globalThis & {
  __metricsBuffer?: MetricPoint[];
};

function getBuffer(): MetricPoint[] {
  const globalCache = globalThis as GlobalMetricsCache;
  if (!globalCache.__metricsBuffer) {
    globalCache.__metricsBuffer = [];
  }
  return globalCache.__metricsBuffer;
}

export function recordMetric(point: Omit<MetricPoint, "timestamp">): void {
  const buffer = getBuffer();
  buffer.push({
    ...point,
    timestamp: new Date().toISOString(),
  });

  if (buffer.length > MAX_POINTS) {
    buffer.splice(0, buffer.length - MAX_POINTS);
  }
}

export function getMetricsSnapshot() {
  return [...getBuffer()];
}

export function clearMetrics() {
  const buffer = getBuffer();
  buffer.splice(0, buffer.length);
}
