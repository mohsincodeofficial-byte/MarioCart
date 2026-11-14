import {
  Engine,
  Scene,
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  MeshBuilder,
  StandardMaterial,
  FollowCamera,
  ArcRotateCamera,
  TransformNode,
  Mesh,
} from '@babylonjs/core';
import { CONSTANTS } from '../shared/protocol';

export class KartScene {
  public scene: Scene;
  public kartRoot: TransformNode;
  public camera: FollowCamera | ArcRotateCamera;
  private kartChassis!: Mesh;
  private wheels: Mesh[] = [];

  constructor(public engine: Engine, public canvas: HTMLCanvasElement) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.08, 0.1, 0.14, 1.0);

    this.kartRoot = new TransformNode('kartRoot', this.scene);

    this.setupLighting();
    this.setupEnvironment();
    this.buildKartModel();
    this.camera = this.setupCamera();
  }

  private setupLighting(): void {
    // Soft ambient sky light
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.65;
    hemiLight.diffuse = new Color3(0.9, 0.95, 1.0);
    hemiLight.groundColor = new Color3(0.2, 0.25, 0.3);

    // Directional sunlight for depth and highlights
    const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, -1), this.scene);
    dirLight.position = new Vector3(20, 40, 20);
    dirLight.intensity = 0.75;
    dirLight.diffuse = new Color3(1.0, 0.98, 0.9);
  }

  private setupEnvironment(): void {
    const { minX, maxX, minZ, maxZ } = CONSTANTS.TRACK_BOUNDS;
    const trackWidth = maxX - minX;
    const trackHeight = maxZ - minZ;

    // 1. Ground Plane (Asphalt track surface)
    const ground = MeshBuilder.CreateGround(
      'ground',
      { width: trackWidth + 16, height: trackHeight + 16, subdivisions: 4 },
      this.scene
    );
    const groundMat = new StandardMaterial('groundMat', this.scene);
    groundMat.diffuseColor = new Color3(0.15, 0.16, 0.18);
    groundMat.specularColor = new Color3(0.1, 0.1, 0.1);
    ground.material = groundMat;

    // 2. Track inner racing surface with contrasting grid / checker style
    const trackArea = MeshBuilder.CreateGround(
      'trackArea',
      { width: trackWidth, height: trackHeight, subdivisions: 2 },
      this.scene
    );
    trackArea.position.y = 0.02;
    const trackMat = new StandardMaterial('trackMat', this.scene);
    trackMat.diffuseColor = new Color3(0.22, 0.24, 0.28);
    trackMat.specularColor = new Color3(0.15, 0.15, 0.15);
    trackArea.material = trackMat;

    // 3. Grid lines / Center track markers
    const centerLine = MeshBuilder.CreateBox(
      'centerLine',
      { width: 0.4, height: 0.03, depth: trackHeight - 4 },
      this.scene
    );
    centerLine.position.y = 0.03;
    const centerMat = new StandardMaterial('centerMat', this.scene);
    centerMat.diffuseColor = new Color3(0.95, 0.8, 0.1);
    centerLine.material = centerMat;

    // 4. Track Boundary Walls with red/white racing curbs
    const wallHeight = 1.0;
    const wallThickness = 0.8;

    const wallMat = new StandardMaterial('wallMat', this.scene);
    wallMat.diffuseColor = new Color3(0.85, 0.15, 0.15); // Vibrant red boundary

    // North wall
    const northWall = MeshBuilder.CreateBox(
      'northWall',
      { width: trackWidth + wallThickness * 2, height: wallHeight, depth: wallThickness },
      this.scene
    );
    northWall.position = new Vector3(0, wallHeight / 2, maxZ + wallThickness / 2);
    northWall.material = wallMat;

    // South wall
    const southWall = MeshBuilder.CreateBox(
      'southWall',
      { width: trackWidth + wallThickness * 2, height: wallHeight, depth: wallThickness },
      this.scene
    );
    southWall.position = new Vector3(0, wallHeight / 2, minZ - wallThickness / 2);
    southWall.material = wallMat;

    // East wall
    const eastWall = MeshBuilder.CreateBox(
      'eastWall',
      { width: wallThickness, height: wallHeight, depth: trackHeight + wallThickness * 2 },
      this.scene
    );
    eastWall.position = new Vector3(maxX + wallThickness / 2, wallHeight / 2, 0);
    eastWall.material = wallMat;

    // West wall
    const westWall = MeshBuilder.CreateBox(
      'westWall',
      { width: wallThickness, height: wallHeight, depth: trackHeight + wallThickness * 2 },
      this.scene
    );
    westWall.position = new Vector3(minX - wallThickness / 2, wallHeight / 2, 0);
    westWall.material = wallMat;
  }

  private buildKartModel(): void {
    // Primary Kart Red Paint Material
    const bodyMat = new StandardMaterial('kartBodyMat', this.scene);
    bodyMat.diffuseColor = new Color3(0.95, 0.18, 0.15); // Race red
    bodyMat.specularColor = new Color3(0.6, 0.6, 0.6);

    // Dark Cockpit Material
    const darkMat = new StandardMaterial('kartDarkMat', this.scene);
    darkMat.diffuseColor = new Color3(0.08, 0.08, 0.1);

    // Rubber Wheel Material
    const wheelMat = new StandardMaterial('wheelMat', this.scene);
    wheelMat.diffuseColor = new Color3(0.05, 0.05, 0.05);

    // Headlight Emissive Material
    const lightMat = new StandardMaterial('lightMat', this.scene);
    lightMat.emissiveColor = new Color3(1.0, 0.95, 0.5);

    // 1. Chassis Body (wedge / sleek kart body)
    this.kartChassis = MeshBuilder.CreateBox(
      'kartChassis',
      { width: 1.1, height: 0.35, depth: 1.9 },
      this.scene
    );
    this.kartChassis.position.y = 0.3;
    this.kartChassis.material = bodyMat;
    this.kartChassis.parent = this.kartRoot;

    // 2. Front Nose Cone
    const nose = MeshBuilder.CreateCylinder(
      'kartNose',
      { height: 0.6, diameterTop: 0.0, diameterBottom: 0.8, tessellation: 4 },
      this.scene
    );
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position = new Vector3(0, 0.28, 1.15);
    nose.material = bodyMat;
    nose.parent = this.kartRoot;

    // 3. Cockpit & Seat
    const cockpit = MeshBuilder.CreateBox(
      'cockpit',
      { width: 0.65, height: 0.3, depth: 0.7 },
      this.scene
    );
    cockpit.position = new Vector3(0, 0.45, -0.1);
    cockpit.material = darkMat;
    cockpit.parent = this.kartRoot;

    // 4. Rear Spoiler Wing
    const spoiler = MeshBuilder.CreateBox(
      'spoiler',
      { width: 1.2, height: 0.08, depth: 0.35 },
      this.scene
    );
    spoiler.position = new Vector3(0, 0.68, -0.85);
    spoiler.material = bodyMat;
    spoiler.parent = this.kartRoot;

    // Spoiler Struts
    const strutLeft = MeshBuilder.CreateBox('strutL', { width: 0.05, height: 0.3, depth: 0.05 }, this.scene);
    strutLeft.position = new Vector3(-0.35, 0.5, -0.85);
    strutLeft.material = darkMat;
    strutLeft.parent = this.kartRoot;

    const strutRight = MeshBuilder.CreateBox('strutR', { width: 0.05, height: 0.3, depth: 0.05 }, this.scene);
    strutRight.position = new Vector3(0.35, 0.5, -0.85);
    strutRight.material = darkMat;
    strutRight.parent = this.kartRoot;

    // 5. Headlights
    const lightL = MeshBuilder.CreateSphere('lightL', { diameter: 0.16 }, this.scene);
    lightL.position = new Vector3(-0.35, 0.32, 0.95);
    lightL.material = lightMat;
    lightL.parent = this.kartRoot;

    const lightR = MeshBuilder.CreateSphere('lightR', { diameter: 0.16 }, this.scene);
    lightR.position = new Vector3(0.35, 0.32, 0.95);
    lightR.material = lightMat;
    lightR.parent = this.kartRoot;

    // 6. Wheels (4 cylinders)
    const wheelPositions = [
      { name: 'wFL', x: -0.65, y: 0.22, z: 0.65 },
      { name: 'wFR', x: 0.65, y: 0.22, z: 0.65 },
      { name: 'wRL', x: -0.65, y: 0.24, z: -0.65 },
      { name: 'wRR', x: 0.65, y: 0.24, z: -0.65 },
    ];

    for (const wp of wheelPositions) {
      const wheel = MeshBuilder.CreateCylinder(
        wp.name,
        { height: 0.22, diameter: 0.44, tessellation: 16 },
        this.scene
      );
      wheel.rotation.z = Math.PI / 2; // Lay flat as rolling wheel
      wheel.position = new Vector3(wp.x, wp.y, wp.z);
      wheel.material = wheelMat;
      wheel.parent = this.kartRoot;
      this.wheels.push(wheel);
    }
  }

  private setupCamera(): FollowCamera {
    // Dynamic Follow Camera for TV viewing
    const camera = new FollowCamera('followCam', new Vector3(0, 10, -15), this.scene);
    camera.lockedTarget = this.kartRoot as any;
    camera.radius = 12.0;          // Distance behind kart
    camera.heightOffset = 5.5;      // Height above kart
    camera.rotationOffset = 180;    // Directly behind kart (0/180 depends on forward facing axis)
    camera.cameraAcceleration = 0.08; // Smooth chase responsiveness
    camera.maxCameraSpeed = 25.0;
    return camera;
  }

  public setCameraMode(mode: 'follow' | 'overview'): void {
    if (mode === 'overview') {
      const overviewCam = new ArcRotateCamera(
        'overviewCam',
        -Math.PI / 2,
        Math.PI / 3.5,
        50,
        Vector3.Zero(),
        this.scene
      );
      this.scene.activeCamera = overviewCam;
      overviewCam.attachControl(this.canvas, true);
    } else {
      this.scene.activeCamera = this.camera;
    }
  }

  public applyTransform(x: number, y: number, z: number, rotation: number, speed: number): void {
    this.kartRoot.position.set(x, y, z);
    this.kartRoot.rotation.y = rotation;

    // Spin wheels according to speed
    if (Math.abs(speed) > 0.05) {
      const spinDelta = speed * 0.08;
      for (const wheel of this.wheels) {
        wheel.rotation.x += spinDelta;
      }
    }
  }
}
