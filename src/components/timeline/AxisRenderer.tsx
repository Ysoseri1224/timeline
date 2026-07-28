import { useMemo, useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { line, curveBumpX, curveBumpY } from 'd3-shape';
import gsap from 'gsap';
import rough from 'roughjs/bundled/rough.esm.js';
import { yForDate } from './layout';
import type { TimelineAxis, TimelineLayout, TimelineEvent } from './types';

type Point = [number, number];

interface AxisRendererProps {
  axes: TimelineAxis[];
  events: TimelineEvent[];
  layout: TimelineLayout;
  filters: Set<number>;
}

const pathFor = (points: Point[], curve: typeof curveBumpY = curveBumpY): string =>
  line<Point>()
    .x((point) => point[0])
    .y((point) => point[1])
    .curve(curve)(points) ?? '';

export default function AxisRenderer({ axes, events, layout, filters }: AxisRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const axisMap = useMemo(() => new Map(axes.map((axis) => [axis.id, axis])), [axes]);
  const filterKey = [...filters].sort((a, b) => a - b).join(',');

  useGSAP(
    () => {
      const svg = svgRef.current;
      if (!svg) return;
      svg.replaceChildren();
      const renderer = rough.svg(svg);
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const renderedPaths: SVGPathElement[] = [];

      const appendRoughPath = (
        pathData: string,
        color: string,
        seed: number,
        options: { width?: number; opacity?: number; dashed?: boolean; roughness?: number } = {},
      ) => {
        if (!pathData) return;
        const group = renderer.path(pathData, {
          seed,
          stroke: color,
          strokeWidth: options.width ?? 3.4,
          roughness: options.roughness ?? 2,
          bowing: 1.45,
          fill: 'none',
          disableMultiStroke: false,
          strokeLineDash: options.dashed ? [8, 12] : undefined,
        });
        group.setAttribute('opacity', String(options.opacity ?? 0.88));
        group.setAttribute('aria-hidden', 'true');
        svg.appendChild(group);
        renderedPaths.push(...Array.from(group.querySelectorAll('path')));
      };

      const activeAxes = axes
        .filter((axis) => layout.axisX.has(axis.id))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

      activeAxes.forEach((axis, axisIndex) => {
        const x = layout.axisX.get(axis.id);
        if (x === undefined) return;
        const filteredOut = filters.size > 0 && !filters.has(axis.id);
        const startY = axis.start_date ? yForDate(layout, axis.start_date) : layout.top - 30;
        const endY = axis.end_date ? yForDate(layout, axis.end_date) : layout.bottom;
        const axisEvents = events
          .filter((event) => event.axis_ids.includes(axis.id))
          .map((event) => yForDate(layout, event.event_date))
          .filter((eventY) => eventY >= startY && eventY <= endY)
          .sort((a, b) => a - b);
        const points = [startY, ...axisEvents, endY].filter(
          (value, index, values) => index === 0 || Math.abs(value - (values[index - 1] ?? value)) > 2,
        );

        for (let index = 0; index < points.length - 1; index += 1) {
          const fromY = points[index];
          const toY = points[index + 1];
          if (fromY === undefined || toY === undefined) continue;
          const silent = toY - fromY > 360 && index > 0 && index < points.length - 2;
          const gentleOffset = ((axis.id * 17 + index * 11) % 9) - 4;
          appendRoughPath(
            pathFor([
              [x, fromY],
              [x + gentleOffset, (fromY + toY) / 2],
              [x, toY],
            ]),
            axis.color,
            axis.id * 101 + index + 1,
            {
              dashed: filteredOut || silent,
              opacity: filteredOut ? 0.2 : silent ? 0.52 : 0.9,
              width: filteredOut ? 2.4 : 3.6,
            },
          );
        }

        if (axis.parent_axis_id && axisMap.has(axis.parent_axis_id)) {
          const parentX = layout.axisX.get(axis.parent_axis_id);
          if (parentX !== undefined) {
            appendRoughPath(
              pathFor([
                [parentX, startY - 72],
                [(parentX + x) / 2, startY - 24],
                [x, startY + 28],
              ]),
              axis.color,
              axis.id * 1009,
              { width: 2.7, opacity: filteredOut ? 0.18 : 0.78 },
            );
          }
        }

        if (axis.end_date) {
          const mergeX = axis.merge_axis_id ? layout.axisX.get(axis.merge_axis_id) : undefined;
          const targetX = mergeX ?? x + (axisIndex % 2 === 0 ? -58 : 58);
          appendRoughPath(
            pathFor([
              [x, endY - 24],
              [(x + targetX) / 2, endY + 28],
              [targetX, endY + 72],
            ]),
            axis.color,
            axis.id * 2017,
            { width: 2.6, opacity: filteredOut ? 0.16 : mergeX ? 0.72 : 0.42 },
          );
        }
      });

      events.forEach((event) => {
        const eventAxes = event.axis_ids
          .map((axisId) => ({ axis: axisMap.get(axisId), x: layout.axisX.get(axisId) }))
          .filter((item): item is { axis: TimelineAxis; x: number } => Boolean(item.axis && item.x !== undefined))
          .sort((a, b) => a.x - b.x);
        if (eventAxes.length < 2) return;
        const y = yForDate(layout, event.event_date);
        const first = eventAxes[0];
        const last = eventAxes[eventAxes.length - 1];
        if (!first || !last) return;
        appendRoughPath(
          pathFor(
            [
              [first.x, y],
              [(first.x + last.x) / 2, y + 16],
              [last.x, y],
            ],
            curveBumpX,
          ),
          event.color || first.axis.color,
          event.id * 3037,
          { width: 2.2, opacity: 0.62, roughness: 1.6 },
        );
      });

      if (!reducedMotion && renderedPaths.length > 0) {
        renderedPaths.forEach((path) => {
          const length = path.getTotalLength();
          gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        });
        gsap.to(renderedPaths, {
          strokeDashoffset: 0,
          duration: 0.6,
          ease: 'power2.out',
          stagger: { amount: Math.min(0.42, renderedPaths.length * 0.018), from: 'start' },
          clearProps: 'strokeDasharray,strokeDashoffset',
        });
      }
    },
    {
      scope: svgRef,
      dependencies: [axes, events, layout, filterKey, axisMap],
      revertOnUpdate: true,
    },
  );

  const activeAxes = axes.filter((axis) => layout.axisX.has(axis.id));

  return (
    <div className="axis-layer" aria-hidden="true">
      <svg
        ref={svgRef}
        className="axis-canvas"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
      />
      <div className="axis-labels">
        {activeAxes.map((axis) => {
          const x = layout.axisX.get(axis.id) ?? 0;
          const filteredOut = filters.size > 0 && !filters.has(axis.id);
          return (
            <span
              key={axis.id}
              className={`axis-label${filteredOut ? ' is-muted' : ''}`}
              style={{ left: `${(x / layout.width) * 100}%`, '--axis-color': axis.color } as React.CSSProperties}
            >
              {axis.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
