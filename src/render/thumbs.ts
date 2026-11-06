import * as THREE from 'three';
import { BUILDINGS, type BuildingType, type UnitType } from '../sim/data/defs';
import { buildingModel, turretHead, unitModel } from './models/catalog';

const SIZE = 112;

/** Renders each unit and building once so the HUD buttons show the real models. */
export function renderThumbnails(team: number): Map<string, string> {
  const result = new Map<string, string>();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE);
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#889977', 1.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2.4);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);

  const shoot = (key: string, geometries: [THREE.BufferGeometry, number][], span: number): void => {
    const group = new THREE.Group();
    for (const [geometry, y] of geometries) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = y;
      group.add(mesh);
    }
    group.rotation.y = -0.6;
    scene.add(group);
    const d = span * 2.6;
    camera.position.set(0, d * 0.75, d);
    camera.lookAt(0, span * 0.22, 0);
    renderer.render(scene, camera);
    result.set(key, renderer.domElement.toDataURL('image/png'));
    scene.remove(group);
  };

  const units: [UnitType, number][] = [['infantry', 0.75], ['antitank', 0.75], ['tank', 1.4], ['heli', 2]];
  for (const [type, span] of units) {
    const model = unitModel(type, team);
    shoot(type, model.parts.map((p) => [p.geometry, p.role === 'turret' ? 0.33 : p.role === 'rotor' ? 0.42 : 0]), span);
  }
  for (const type of Object.keys(BUILDINGS) as BuildingType[]) {
    const def = BUILDINGS[type];
    const parts: [THREE.BufferGeometry, number][] = [[buildingModel(type, team), 0]];
    if (type === 'turret') parts.push([turretHead(team), 0.6]);
    shoot(type, parts, type === 'turret' ? 1.5 : Math.max(def.w, def.h) * 1.15);
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return result;
}
