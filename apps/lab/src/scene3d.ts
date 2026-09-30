import * as THREE from "three";
import type { NormalizedFoldGraph } from "../../../packages/core/src/index";
import { assignmentColor } from "./patternView";

export class OrigamiScene {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  private readonly group = new THREE.Group();
  private mesh: THREE.Mesh | undefined;
  private lines: THREE.LineSegments | undefined;
  private dragging = false;
  private lastPointer: [number, number] = [0, 0];

  constructor(private readonly container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.container.append(this.renderer.domElement);
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.4);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    this.camera.position.set(3.2, 2.5, 3.5);
    this.camera.lookAt(0, 0, 0);
    this.group.rotation.x = -0.22;
    this.group.rotation.y = 0.56;

    new ResizeObserver(() => this.resize()).observe(this.container);
    this.installInteraction();
    this.resize();
    this.animate();
  }

  setGraph(graph: NormalizedFoldGraph, vertices?: number[][]): void {
    const coords = vertices ?? toThreeCoordinates(graph);
    this.disposeModel();

    const triangles = triangulateFaces(graph.faces_vertices ?? []);
    const positionValues: number[] = [];
    for (const vertexIndex of triangles) {
      const vertex = coords[vertexIndex];
      if (!vertex) continue;
      positionValues.push(vertex[0] ?? 0, vertex[1] ?? 0, vertex[2] ?? 0);
    }

    if (positionValues.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positionValues, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: 0xe9e6df,
        roughness: 0.74,
        metalness: 0.02,
        side: THREE.DoubleSide,
        flatShading: true,
      });
      this.mesh = new THREE.Mesh(geometry, material);
      this.group.add(this.mesh);
    }

    const edgePositions: number[] = [];
    const edgeColors: number[] = [];
    graph.edges_vertices.forEach((edge, index) => {
      const a = coords[edge[0]];
      const b = coords[edge[1]];
      if (!a || !b) return;
      edgePositions.push(...asVec3(a), ...asVec3(b));
      const color = new THREE.Color(assignmentColor(graph.edges_assignment[index] ?? "U"));
      edgeColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(edgeColors, 3));
    const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 });
    this.lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    this.group.add(this.lines);

    this.fitCamera(coords);
  }

  private fitCamera(coords: number[][]): void {
    if (coords.length === 0) return;
    const box = new THREE.Box3();
    coords.forEach((coord) => box.expandByPoint(new THREE.Vector3(...asVec3(coord))));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.15);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    this.camera.position.set(distance * 0.72, distance * 0.55, distance * 0.82);
    this.camera.near = Math.max(distance / 1000, 0.001);
    this.camera.far = distance * 20;
    this.camera.lookAt(sphere.center);
    this.camera.updateProjectionMatrix();
  }

  private installInteraction(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.lastPointer = [event.clientX, event.clientY];
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastPointer[0];
      const dy = event.clientY - this.lastPointer[1];
      this.group.rotation.y += dx * 0.008;
      this.group.rotation.x += dy * 0.008;
      this.lastPointer = [event.clientX, event.clientY];
    });
    canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    });
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  };

  private disposeModel(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.group.remove(this.mesh);
      this.mesh = undefined;
    }
    if (this.lines) {
      this.lines.geometry.dispose();
      (this.lines.material as THREE.Material).dispose();
      this.group.remove(this.lines);
      this.lines = undefined;
    }
  }
}

function toThreeCoordinates(graph: NormalizedFoldGraph): number[][] {
  return (graph.vertices_coords ?? []).map((vertex) => {
    if (vertex.length >= 3) return [vertex[0] ?? 0, vertex[1] ?? 0, vertex[2] ?? 0];
    return [vertex[0] ?? 0, 0, vertex[1] ?? 0];
  });
}

function triangulateFaces(faces: number[][]): number[] {
  const indices: number[] = [];
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i += 1) {
      const a = face[0];
      const b = face[i];
      const c = face[i + 1];
      if (a !== undefined && b !== undefined && c !== undefined) indices.push(a, b, c);
    }
  }
  return indices;
}

function asVec3(vertex: readonly number[]): [number, number, number] {
  return [vertex[0] ?? 0, vertex[1] ?? 0, vertex[2] ?? 0];
}
