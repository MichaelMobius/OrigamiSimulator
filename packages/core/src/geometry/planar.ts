import type { Vertex } from "../fold/types.js";

export type Vec2 = readonly [number, number];
export type ProjectionAxes = readonly [0 | 1 | 2, 0 | 1 | 2];

export interface SegmentIntersection {
  point: Vec2;
  t: number;
  u: number;
}

const EPSILON = 1e-9;

export function chooseProjectionAxes(vertices: readonly Vertex[]): ProjectionAxes {
  if (vertices.length === 0 || vertices.every((vertex) => vertex.length < 3)) return [0, 1];

  const ranges = [0, 1, 2].map((axis) => {
    const values = vertices.map((vertex) => Number(vertex[axis] ?? 0));
    return Math.max(...values) - Math.min(...values);
  });

  const candidates: Array<{ axes: ProjectionAxes; area: number }> = [
    { axes: [0, 1], area: ranges[0]! * ranges[1]! },
    { axes: [0, 2], area: ranges[0]! * ranges[2]! },
    { axes: [1, 2], area: ranges[1]! * ranges[2]! },
  ];
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0]!.axes;
}

export function projectVertex(vertex: Vertex, axes: ProjectionAxes): Vec2 {
  return [Number(vertex[axes[0]] ?? 0), Number(vertex[axes[1]] ?? 0)];
}

export function projectVertices2D(vertices: readonly Vertex[]): Vec2[] {
  const axes = chooseProjectionAxes(vertices);
  return vertices.map((vertex) => projectVertex(vertex, axes));
}

export function signedPolygonArea(points: readonly Vec2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

export function faceSignedArea(face: readonly number[], vertices: readonly Vertex[]): number {
  const faceVertices = face.map((index) => vertices[index]).filter((vertex): vertex is Vertex => vertex !== undefined);
  if (faceVertices.length !== face.length) return 0;
  const axes = chooseProjectionAxes(faceVertices);
  return signedPolygonArea(faceVertices.map((vertex) => projectVertex(vertex, axes)));
}

export function isSimpleFace(face: readonly number[], vertices: readonly Vertex[]): boolean {
  if (face.length < 3 || new Set(face).size !== face.length) return false;
  const faceVertices = face.map((index) => vertices[index]).filter((vertex): vertex is Vertex => vertex !== undefined);
  if (faceVertices.length !== face.length) return false;
  const axes = chooseProjectionAxes(faceVertices);
  const points = faceVertices.map((vertex) => projectVertex(vertex, axes));
  if (Math.abs(signedPolygonArea(points)) <= EPSILON) return false;

  for (let i = 0; i < points.length; i += 1) {
    const a1 = points[i]!;
    const a2 = points[(i + 1) % points.length]!;
    for (let j = i + 1; j < points.length; j += 1) {
      const adjacent = j === i || j === (i + 1) % points.length || i === (j + 1) % points.length;
      const wraps = i === 0 && j === points.length - 1;
      if (adjacent || wraps) continue;
      const b1 = points[j]!;
      const b2 = points[(j + 1) % points.length]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

export function isValidFaceDiagonal(
  face: readonly number[],
  vertices: readonly Vertex[],
  vertexA: number,
  vertexB: number,
): boolean {
  const aIndex = face.indexOf(vertexA);
  const bIndex = face.indexOf(vertexB);
  if (aIndex < 0 || bIndex < 0 || aIndex === bIndex || !isSimpleFace(face, vertices)) return false;

  const distance = Math.abs(aIndex - bIndex);
  if (distance === 1 || distance === face.length - 1) return false;

  const faceVertices = face.map((index) => vertices[index]).filter((vertex): vertex is Vertex => vertex !== undefined);
  if (faceVertices.length !== face.length) return false;
  const axes = chooseProjectionAxes(faceVertices);
  const points = faceVertices.map((vertex) => projectVertex(vertex, axes));
  const a = points[aIndex]!;
  const b = points[bIndex]!;

  for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
    const nextIndex = (edgeIndex + 1) % points.length;
    if (
      edgeIndex === aIndex ||
      nextIndex === aIndex ||
      edgeIndex === bIndex ||
      nextIndex === bIndex
    ) {
      continue;
    }
    if (segmentsIntersect(a, b, points[edgeIndex]!, points[nextIndex]!)) return false;
  }

  const midpoint: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return pointInPolygon(midpoint, points);
}

export function triangulateFace(face: readonly number[], vertices: readonly Vertex[]): number[] {
  if (face.length === 3) return isSimpleFace(face, vertices) ? [...face] : [];
  if (!isSimpleFace(face, vertices)) return [];

  const faceVertices = face.map((index) => vertices[index]).filter((vertex): vertex is Vertex => vertex !== undefined);
  if (faceVertices.length !== face.length) return [];
  const axes = chooseProjectionAxes(faceVertices);
  const points = faceVertices.map((vertex) => projectVertex(vertex, axes));
  const winding = Math.sign(signedPolygonArea(points));
  if (winding === 0) return [];

  const remaining = face.map((_, index) => index);
  const triangles: number[] = [];
  let guard = 0;

  while (remaining.length > 3 && guard < face.length * face.length) {
    guard += 1;
    let clipped = false;

    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previous = remaining[(cursor - 1 + remaining.length) % remaining.length]!;
      const current = remaining[cursor]!;
      const next = remaining[(cursor + 1) % remaining.length]!;
      const pa = points[previous]!;
      const pb = points[current]!;
      const pc = points[next]!;
      if (orient2d(pa, pb, pc) * winding <= EPSILON) continue;

      const containsOther = remaining.some((candidate) => {
        if (candidate === previous || candidate === current || candidate === next) return false;
        return pointInTriangle(points[candidate]!, pa, pb, pc);
      });
      if (containsOther) continue;

      triangles.push(face[previous]!, face[current]!, face[next]!);
      remaining.splice(cursor, 1);
      clipped = true;
      break;
    }

    if (!clipped) return [];
  }

  if (remaining.length === 3) {
    triangles.push(face[remaining[0]!]!, face[remaining[1]!]!, face[remaining[2]!]!);
  }
  return triangles;
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function orient2d(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function pointOnSegment(point: Vec2, a: Vec2, b: Vec2): boolean {
  if (Math.abs(orient2d(a, b, point)) > EPSILON) return false;
  return (
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient2d(a, b, c);
  const o2 = orient2d(a, b, d);
  const o3 = orient2d(c, d, a);
  const o4 = orient2d(c, d, b);

  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
      ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) {
    return true;
  }

  return (
    (Math.abs(o1) <= EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(o2) <= EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(o3) <= EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(o4) <= EPSILON && pointOnSegment(b, c, d))
  );
}

export function segmentIntersectionParameters(a: Vec2, b: Vec2, c: Vec2, d: Vec2): SegmentIntersection | undefined {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= EPSILON) return undefined;

  const qpx = c[0] - a[0];
  const qpy = c[1] - a[1];
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return undefined;

  const clampedT = Math.max(0, Math.min(1, t));
  const clampedU = Math.max(0, Math.min(1, u));
  return {
    point: [a[0] + clampedT * rx, a[1] + clampedT * ry],
    t: clampedT,
    u: clampedU,
  };
}

export function pointInPolygon(point: Vec2, polygon: readonly Vec2[]): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    if (pointOnSegment(point, polygon[index]!, polygon[(index + 1) % polygon.length]!)) return true;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const crosses = (pi[1] > point[1]) !== (pj[1] > point[1]) &&
      point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / (pj[1] - pi[1]) + pi[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInTriangle(point: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const o1 = orient2d(a, b, point);
  const o2 = orient2d(b, c, point);
  const o3 = orient2d(c, a, point);
  if (Math.abs(o1) <= EPSILON || Math.abs(o2) <= EPSILON || Math.abs(o3) <= EPSILON) return false;
  const hasNegative = o1 < 0 || o2 < 0 || o3 < 0;
  const hasPositive = o1 > 0 || o2 > 0 || o3 > 0;
  return !(hasNegative && hasPositive);
}
