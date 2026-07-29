import type { CSSProperties } from 'react';
import type { PaperSurfaceSpec } from './paperAging';

interface PaperSurfaceProps {
  current: PaperSurfaceSpec | null;
  previous: PaperSurfaceSpec | null;
}

const textureStyle = (spec: PaperSurfaceSpec): CSSProperties => ({
  WebkitMaskImage: spec.noiseMask,
  maskImage: spec.noiseMask,
});

function SurfaceLayer({ spec, kind }: { spec: PaperSurfaceSpec; kind: 'current' | 'previous' }) {
  return (
    <div className={`paper-surface__layer paper-surface__layer--${kind}`} data-paper-key={spec.key}>
      <div className="paper-surface__tone" style={{ backgroundImage: spec.paperGradient }} />
      <div className="paper-surface__pulp" />
      <div className="paper-surface__texture" style={textureStyle(spec)} />
    </div>
  );
}

export default function PaperSurface({ current, previous }: PaperSurfaceProps) {
  return (
    <div className={`paper-surface${current ? ' is-ready' : ''}`} aria-hidden="true">
      {previous && <SurfaceLayer key="previous" spec={previous} kind="previous" />}
      {current && <SurfaceLayer key="current" spec={current} kind="current" />}
    </div>
  );
}
