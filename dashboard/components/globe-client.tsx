'use client';

import { GlobeViz } from './globe-viz';

export function GlobeWrapper(props: React.ComponentProps<typeof GlobeViz>) {
  return <GlobeViz {...props} />;
}