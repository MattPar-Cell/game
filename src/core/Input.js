/**
 * Input — pointer-lock mouse look + keyboard state. Emits nothing; systems
 * poll `keys`, `mouseDelta`, and button state each frame.
 */
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = { left: false, right: false };
    this.locked = false;
    this.wheel = 0;
    this._justPressed = new Set();
    this.sensitivity = 0.0022;

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      const code = e.code;
      if (!this.keys.has(code)) this._justPressed.add(code);
      this.keys.add(code);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.buttons.left = true;
      if (e.button === 2) this.buttons.right = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.buttons.left = false;
      if (e.button === 2) this.buttons.right = false;
    };
    this._onWheel = (e) => { this.wheel += Math.sign(e.deltaY); };
    this._onContext = (e) => e.preventDefault();
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  requestLock() {
    this.dom.requestPointerLock?.();
  }

  isDown(code) { return this.keys.has(code); }

  pressed(code) {
    if (this._justPressed.has(code)) return true;
    return false;
  }

  // call once per frame AFTER systems read input
  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this._justPressed.clear();
  }
}
