(function(exports) {
  exports.draw_player = function(ctx, player, is_other_player) {
    const render_position = player.client_interp_position;

    render_position.mutadd(player.position.sub(render_position).normalized().mult(new rebound_common.Vector(
      0.5 * render_position.distance(player.position),
      0.5 * render_position.distance(player.position)
    )));

    ctx.save();
    if (player.current_power_up === "invisibility") {
      ctx.globalAlpha = 0.1;
    }
    
    let is_inside_any_object = false;
    
    rebound_common.world.tiles.forEach(tile => {
      if (tile.layer !== "bg" && rebound_common.testrectcollision(render_position.getX(), render_position.getY(), rebound_common.conf.player_size, rebound_common.conf.player_size, tile.x, tile.y, tile.w, tile.h)) {
        is_inside_any_object = true;
      }
    })
    
    if (is_inside_any_object) {
      ctx.globalCompositeOperation = "darken";
    }

    ctx.save();
    ctx.fillStyle = "gold";
    ctx.strokeStyle = "darkred";
    ctx.fillRect(render_position.getX(), render_position.getY(), rebound_common.conf.player_size, rebound_common.conf.player_size);
    ctx.strokeRect(render_position.getX(), render_position.getY(), rebound_common.conf.player_size, rebound_common.conf.player_size);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "gold";
    ctx.lineWidth = 2;
    ctx.textAlign = "center";
    ctx.font = "15px monospace";
    ctx.strokeText(player.name, render_position.getX() + rebound_common.conf.player_size / 2, render_position.getY() - 20);
    ctx.fillText(player.name, render_position.getX() + rebound_common.conf.player_size / 2, render_position.getY() - 20);
    ctx.restore();

    if (is_other_player) {
      ctx.save();
      ctx.font = "12px monospace";
      ctx.strokeStyle = "#fff";
      ctx.strokeText(player.health + " / 20", render_position.getX() - rebound_common.conf.player_size / 2, render_position.getY() - 40);
      ctx.fillText(player.health + " / 20", render_position.getX() - rebound_common.conf.player_size / 2, render_position.getY() - 40);
      ctx.restore();
    }

    ctx.restore();
  }

  exports.draw_gun = function(ctx, position, gun_dir) {
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = "#939393";
    ctx.lineWidth = 10;
    ctx.moveTo(position.getX(), position.getY());
    ctx.lineTo(position.getX() + gun_dir.getX(), position.getY() + gun_dir.getY());
    ctx.stroke();
    ctx.closePath();

    ctx.beginPath();
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 7;
    ctx.moveTo(position.getX(), position.getY());
    ctx.lineTo(position.getX() + gun_dir.getX(), position.getY() + gun_dir.getY());
    ctx.stroke();
    ctx.closePath();

    ctx.beginPath();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 10;
    ctx.moveTo(position.getX(), position.getY());
    ctx.lineTo(position.getX() + gun_dir.getX() / 4, position.getY() + gun_dir.getY() / 4);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  exports.Camera = class {
    constructor(lookvec) {
      this.lookvec = lookvec;
      this.zoom = 1;
    }

    attach(ctx, w, h) {
      ctx.save();
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-Math.floor(this.lookvec.getX()) + w / 2, -Math.floor(this.lookvec.getY()) + h / 2);
    }

    setZoom(f) {
      this.zoom = f;
    }

    getLookVec() {
      return this.lookvec;
    }

    toWorldPos(pos, w, h) {
      return pos.add(this.lookvec).sub(new rebound_common.Vector(w / 2, h / 2));
    }

    dettach(ctx) {
      ctx.restore();
    }
  }

  exports.draw_world = function(ctx, w, h, cam, custom_block_code, cs_world) {
    const min = cam.toWorldPos(new rebound_common.Vector(0, 0), w, h);
    const max = cam.toWorldPos(new rebound_common.Vector(w, h), w, h);
    const center = cam.toWorldPos(new rebound_common.Vector(w / 2, h / 2), w, h);

    const culled_objects = (cs_world || rebound_common.world).tiles.map((obj, i) => {return {obj, i}}).filter(obj => {
      obj = obj.obj;
      const bound = 350;
      if (obj.x + obj.w + bound < min.getX() || obj.x - bound > max.getX() || obj.y + obj.h + bound < min.getY() || obj.y - bound > max.getY()) {
        return false;
      }
      return true;
    });
    const renderer_3d = new exports.PointPerspective3DRenderer();
    culled_objects.forEach(obj => {
      obj = obj.obj;
      if (obj.layer === "obj" || obj.layer === "dec") {
        const depth = obj.layer === "dec" ? 0.015 : 0.25;
        renderer_3d.addFace("red",
          obj.x, obj.y,
          obj.x + obj.w, obj.y,
          depth);
        renderer_3d.addFace("green",
          obj.x, obj.y + obj.h,
          obj.x + obj.w, obj.y + obj.h,
          depth);

        renderer_3d.addFace("blue",
          obj.x, obj.y,
          obj.x, obj.y + obj.h,
          depth);
        renderer_3d.addFace("gold",
          obj.x + obj.w, obj.y,
          obj.x + obj.w, obj.y + obj.h,
          depth);
      }
    });

    const renderLayer = (layer_name) => {
      const obj_faces = [];

      culled_objects.forEach((obj) => {
        let i = obj.i;
        obj = obj.obj;
        if (obj.layer === layer_name) {
          // Obj
          ctx.save();
          
          const draw_one_way_arrow = () => {
            if (typeof obj.one_way !== typeof 1) return;
            const axis = obj.one_way < 2 ? "x" : "y";
            const positive = obj.one_way % 2 !== 0;
            
            const cx = obj.x + obj.w / 2;
            const cy = obj.y + obj.h / 2;
            
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(0.5, 0.5);
            ctx.setLineDash([5, 5]);
            
            ctx.strokeStyle = "red";
            ctx.lineWidth = 10;
            if (axis === "y") {
              ctx.beginPath();
              ctx.moveTo(- obj.w / 2, ((obj.h / 2) * (positive ? -1 : 1)));
              ctx.lineTo(0, 0);
              ctx.lineTo(obj.w / 2, ((obj.h / 2) * (positive ? -1 : 1)));
            } else {
              ctx.beginPath();
              ctx.moveTo(((obj.w / 2) * (positive ? -1 : 1)), - obj.h / 2);
              ctx.lineTo(0, 0);
              ctx.lineTo(((obj.w / 2) * (positive ? -1 : 1)), obj.h / 2);
            }
            
            ctx.stroke();
            ctx.closePath();
            
            ctx.restore();
          }
          
          const draw = () => {
            ctx.fillStyle = obj.color;
            
            if (layer_name === "bg") {
              ctx.beginPath();
              const vertices = [exports.PP3Dmagic(obj.x, obj.y, center, 0.25),
                                exports.PP3Dmagic(obj.x + obj.w, obj.y, center, 0.25),
                                exports.PP3Dmagic(obj.x + obj.w, obj.y + obj.h, center, 0.25),
                               exports.PP3Dmagic(obj.x, obj.y + obj.h, center, 0.25)];
              vertices.forEach((vec_p, index) => {
                if (index === 0) {
                  ctx.moveTo(vec_p.getX(), vec_p.getY());
                } else {
                  ctx.lineTo(vec_p.getX(), vec_p.getY());
                }
              });
              
              ctx.stroke();
              ctx.fill();
            } else {
              ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
            }
            
            draw_one_way_arrow();
          }
          
          if (typeof custom_block_code === "function") {
            custom_block_code(obj, draw, i);
          } else {
            draw();
          }
          
          ctx.restore();
        }
      });
    }

    renderLayer("bg"); // Background
    renderer_3d.render(ctx, center);
    renderLayer("obj"); // Object
    renderLayer("dec"); // Decor
  }
  
  exports.draw_crystals = function(ctx, power_up_crystal_data, total_frames) {
    rebound_common.world.power_up_boxes.forEach(function(box, i) {
      if (i < power_up_crystal_data.length) { // Used to ensure that the  data exists for each power up box
        const box_data = power_up_crystal_data[i];

        if (box_data.health !== 0) {
          ctx.save();
          ctx.translate(box.x, box.y);
          ctx.rotate(total_frames / 100);

          if (box_data.health === -1) {
            ctx.globalAlpha = 0.5;
          }

          const box_gradient = ctx.createRadialGradient(-25, -25, 5, 25, 25, 100);
          box_gradient.addColorStop(0, box_data.health > 0 ? "lightblue" : "#ccc");
          box_gradient.addColorStop(1, box_data.health > 0 ? "lime" : "#aaa");

          ctx.fillStyle = box_gradient;
          ctx.fillRect(-25, -25, 50, 50);

          const outline_gradient = ctx.createLinearGradient(-25, -25, 25, 25);
          outline_gradient.addColorStop(0, box_data.health > 0 ? "red" : "#eee");
          outline_gradient.addColorStop(1, box_data.health > 0 ? "blue" : "black");

          ctx.strokeStyle = outline_gradient;
          ctx.lineWidth = 5;
          ctx.strokeRect(-25, -25, 50, 50);

          ctx.restore();
          ctx.save();
          if (box_data.health > 0) {
            ctx.fillStyle = "red";
            ctx.fillRect(box.x - 25, box.y - 50, 50, 10);

            const health_gradient = ctx.createLinearGradient(box.x - 25, box.y - 50, box.x + 50 * (box_data.health / 5), box.y + 10);
            health_gradient.addColorStop(0, "green");
            health_gradient.addColorStop(1, "lime");

            ctx.fillStyle = health_gradient;
            ctx.fillRect(box.x - 25, box.y - 50, 50 * (box_data.health / 5), 10);
          } else {
            ctx.fillStyle = "red";
            ctx.font = "15px Bangers";
            ctx.textAlign = "center";
            ctx.alignmentBaseline = "middle";
            ctx.fillText(box_data.recharge_time + "s", box.x, box.y - 50)
          }

          ctx.restore();
        } else {
          const gradient = ctx.createLinearGradient(box.x - 50, box.y - 50, box.x + 50, box.y + 50);
          gradient.addColorStop(0, "gold");
          gradient.addColorStop(1, "red");

          ctx.save();
          ctx.beginPath();
          ctx.lineWidth = 5;
          ctx.strokeStyle = gradient;
          ctx.arc(box.x, box.y, 25, 0, 2 * Math.PI);
          ctx.stroke();
          ctx.closePath();

          ctx.fillStyle = "gold";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = "50px monospace";
          ctx.fillText("⍰", box.x, box.y);
          ctx.restore();
        }
      }
    });
  }

  exports.draw_kill_line = function(ctx, camera, screen_dim, line_y) {
    ctx.save();
    ctx.strokeStyle = "#F44336";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(camera.toWorldPos(
      new rebound_common.Vector(0, 0),
      screen_dim.getX(),
      screen_dim.getY()
    ).getX(), line_y);

    ctx.lineTo(camera.toWorldPos(
      new rebound_common.Vector(screen_dim.getX(), 0),
      screen_dim.getX(),
      screen_dim.getY()
    ).getX(), line_y);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();
  }

  exports.draw_text_colored = function(ctx, text, x, y, font_style, calculated_line_height, no_center) {
    let cy = y;
    text.forEach(line => {
      let cw = 0;
      line.forEach(component => {
        ctx.save();
        ctx.font = font_style;
        cw += ctx.measureText(component.text).width;
        ctx.restore();
      });

      let cx = !no_center ? x - cw / 2 : x;
      line.forEach(component => {
        ctx.save();
        ctx.textAlign = "left";
        ctx.font = font_style;
        ctx.fillStyle = component.color;
        ctx.strokeStyle = component.color;

        ctx.fillText(component.text, cx, cy);
        cx += ctx.measureText(component.text).width;
        ctx.restore();
      });

      cy += calculated_line_height;
    });
  }

  exports.CanvasApplication = class {
    // Boilerplate
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = this.canvas.getContext('2d');
      this.keys = {};
      this.mouse_pos = new rebound_common.Vector(0, 0);
      this.mousedown = false;
      this.rmousedown = false;
      this.beams = [];

      this.ctx.mozImageSmoothingEnabled = false;
      this.ctx.webkitImageSmoothingEnabled = false;
      this.ctx.msImageSmoothingEnabled = false;
      this.ctx.imageSmoothingEnabled = false;

      this.resizecanvas();
      window.addEventListener("resize", this.resizecanvas.bind(this));
      window.addEventListener("keydown", this.keypress_down_handler.bind(this));
      window.addEventListener("keyup", this.keypress_up_handler.bind(this));
      this.canvas.addEventListener("mousemove", this.mousemoved_handler.bind(this));
      this.canvas.addEventListener("mousedown", this.mouse_down_handler.bind(this));
      window.addEventListener("contextmenu", e => {
        e.preventDefault();
      });
      window.addEventListener("mouseup", this.mouse_up_handler.bind(this));

      this.last_sec = Date.now();
      this.last_tick = Date.now();
      this.frames = 0;
      this.fps = -719;
      this.total_frames = 0;

      this.init();
      this.tick();
    }

    resizecanvas() {
      const pixel_ratio = (
        (window.devicePixelRatio || 1) / // DRP
        (this.ctx.webkitBackingStorePixelRatio ||
          this.ctx.mozBackingStorePixelRatio ||
          this.ctx.msBackingStorePixelRatio ||
          this.ctx.oBackingStorePixelRatio ||
          this.ctx.backingStorePixelRatio || 1) // BSR
      );

      this.canvas.width = window.innerWidth * pixel_ratio;
      this.canvas.height = window.innerHeight * pixel_ratio;

      this.canvas.style.width = window.innerWidth + "px";
      this.canvas.style.height = window.innerHeight + "px";

      this.ctx.scale(pixel_ratio, pixel_ratio);
      this.pixel_ratio = pixel_ratio;
    }

    keypress_up_handler(e) {
      this.keys[e.keyCode] = false;
      this.app_keyup(e);
    }

    keypress_down_handler(e) {
      this.keys[e.keyCode] = true;
      this.app_keydown(e);
    }

    mousemoved_handler(e) {
      this.mouse_pos.setX(e.clientX);
      this.mouse_pos.setY(e.clientY);
    }

    mouse_up_handler(e) {
      if (e.button === 0) {
        this.mousedown = false;
      }
      
      if (e.button === 2) {
        this.rmousedown = false;
      }
      
      this.app_mouseup(e);
    }

    mouse_down_handler(e) {
      if (e.button === 0) {
        this.mousedown = true;
      }
      
      if (e.button === 2) {
        this.rmousedown = true;
      }
      
      this.app_mousedown(e);
    }
    
    app_keydown() {
      
    }
    
    app_keyup() {
      
    }
    
    app_mousedown() {
      
    }
    
    app_mouseup() {
      
    }

    tick() {
      window.requestAnimationFrame(this.tick.bind(this));
      const dt = Date.now() - this.last_tick;

      const ticks_passed = dt / ((1 / 60) * 1000);
      this.frames++;

      if (Date.now() > this.last_sec + 1000) {
        this.last_sec = Date.now();
        this.fps = this.frames;
        this.frames = 0;
      }

      this.total_frames += 1;
      this.update(dt, ticks_passed);
      this.render(this.ctx, this.getWidth(), this.getHeight());
      this.last_tick = Date.now();
      this.last_open_play_dialog = 0;
    }

    getWidth() {
      return this.canvas.width / this.pixel_ratio;
    }

    getHeight() {
      return this.canvas.height / this.pixel_ratio;
    }
  }

  // 3D
  
  exports.PP3Dmagic = function(px, py, center, depth) {
        return new rebound_common.Vector(px, py).add(
          new rebound_common.Vector(
            Math.floor(center.getX() - px),
            Math.floor(center.getY() - py)
        ).mult(new rebound_common.Vector(depth || 0.25, depth || 0.25)).floor()
      );
  }

  exports.PointPerspective3DRenderer = class {
    constructor() {
      this._faces = [];
    }

    addFace(color, x1, y1, x2, y2, depth) {
      this._faces.push({
        color,
        depth,
        p1: new rebound_common.Vector(x1, y1),
        p2: new rebound_common.Vector(x2, y2)
      });
    }

    render(ctx, center) {
      // Render faces
      this._faces.forEach((face, i) => {
        const lt = (x, y) => {
          ctx.lineTo(x, y);
        }

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(face.p1.getX(), face.p1.getY());

        const point_1 = exports.PP3Dmagic(face.p1.getX(), face.p1.getY(), center, face.depth);
        lt(point_1.getX(), point_1.getY());

        const point_2 = exports.PP3Dmagic(face.p2.getX(), face.p2.getY(), center, face.depth);
        lt(point_2.getX(), point_2.getY());

        lt(face.p2.getX(), face.p2.getY());
        ctx.fillStyle = "#3a3a3a";
        ctx.fill();
        ctx.restore();
      });
    }
  }

}((typeof module === "object" ? module.exports : window.rebound_helpers = {})));