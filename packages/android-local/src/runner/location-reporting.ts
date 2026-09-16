type RecordValue = Record<string, unknown>;
type DumpListener = (serialized: string, dump?: unknown) => void;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object'
    ? (value as RecordValue)
    : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function elementGeometry(value: unknown) {
  const element = record(value);
  if (!element) return;
  const center = element.center;
  const point =
    Array.isArray(center) && finite(center[0]) && finite(center[1])
      ? ([center[0], center[1]] as [number, number])
      : undefined;
  const rect = record(element.rect);
  const bounds =
    rect &&
    finite(rect.left) &&
    finite(rect.top) &&
    finite(rect.width) &&
    finite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
      ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
      : undefined;
  if (!point && !bounds) return;
  return {
    point,
    bounds,
    description:
      typeof element.description === 'string' ? element.description : undefined,
  };
}

/**
 * Read the resolved elements owned by TaskRunner, never arbitrary rectangles in
 * model responses, search areas, screenshots, or older planning output.
 * Locate completion carries the actual result; action start carries the resolved
 * action parameters. Both paths are used by aiAct and YAML's standalone aiTap.
 */
export function attachLocationReporting(
  agent: {
    addDumpUpdateListener?: (listener: DumpListener) => unknown;
    onDumpUpdate?: unknown;
  },
  shrinkFactor: number | undefined,
  emit: (event: RecordValue) => void,
): void {
  const reported = new Set<string>();
  const fallbackScale =
    finite(shrinkFactor) && shrinkFactor > 0 ? shrinkFactor : 1;
  const listener: DumpListener = (_serialized, value) => {
    const dump = record(value);
    if (!Array.isArray(dump?.tasks)) return;
    for (const [index, value] of dump.tasks.entries()) {
      const task = record(value);
      if (!task) continue;
      const located =
        task.type === 'Planning' &&
        task.subType === 'Locate' &&
        task.status === 'finished';
      const acting = task.type === 'Action Space' && task.status === 'running';
      if (!located && !acting) continue;
      const key = `${dump.id}:${task.taskId ?? index}`;
      if (reported.has(key)) continue;
      const source = located ? 'output.element' : 'param';
      const candidates = located
        ? [['element', record(task.output)?.element] as const]
        : Object.entries(record(task.param) ?? {});
      const elements = candidates.flatMap(([field, value]) => {
        const geometry = elementGeometry(value);
        return geometry ? [{ field, ...geometry }] : [];
      });
      if (!elements.length) continue;
      reported.add(key);
      const ratio = record(task.uiContext)?.shrunkShotToLogicalRatio;
      // LocalAndroidDevice's logical coordinates are the Android display pixels.
      // Prefer the exact context used by the runner over a global config guess.
      const scale = finite(ratio) && ratio > 0 ? 1 / ratio : fallbackScale;
      const screen = (value: number) => Math.round(value * scale);
      for (const element of elements) {
        const { point, bounds, description, field } = element;
        const rect = bounds
          ? {
              x: screen(bounds.x),
              y: screen(bounds.y),
              w: screen(bounds.w),
              h: screen(bounds.h),
            }
          : {
              x: screen(point![0]) - 24,
              y: screen(point![1]) - 24,
              w: 48,
              h: 48,
            };
        emit({
          event: 'locate',
          rect,
          geometry: bounds ? 'bbox' : 'point',
          source: located ? source : `${source}.${field}`,
          taskId: task.taskId,
          action: task.subType,
          description,
          screenshot: bounds ?? null,
          center: point,
          scale,
        });
        // Locating, typing, scrolling and dragging are not taps. Show a ripple
        // only when a tap action starts, using its authoritative target center.
        if (
          acting &&
          point &&
          ['Tap', 'DoubleClick', 'RightClick', 'LongPress'].includes(
            String(task.subType),
          )
        ) {
          emit({ event: 'tap', x: screen(point[0]), y: screen(point[1]) });
        }
      }
    }
  };
  if (agent.addDumpUpdateListener) {
    agent.addDumpUpdateListener(listener);
  } else {
    // Compatibility with older agents that only expose the single callback.
    const previous = agent.onDumpUpdate;
    agent.onDumpUpdate = (serialized: string, dump?: unknown) => {
      listener(serialized, dump);
      if (typeof previous === 'function')
        previous.call(agent, serialized, dump);
    };
  }
}
