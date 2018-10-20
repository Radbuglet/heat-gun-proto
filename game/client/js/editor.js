(function() {
  class Editor extends rebound_helpers.CanvasApplication {
    // Application code
    init() {
      this.camera = new rebound_helpers.Camera(new rebound_common.Vector(0, 0));
      this.current_drag_data = null;
      this.selected_object_index = -1;
      this.multiselect_resolve_items = null;
      this.multiselect_resolve_index = null;
      this.dragging_movepart_info = null;
      this.dragging_resizepart_info = null;

      this.opt_move_collisions = true;
      this.opt_move_grid = 5;
      this.world = rebound_common.world;
      
      this.active_color_palette = [
        "#0f0f0f",
        "#afafef",
        "#c1bcb2",
        "#ad5e3c",
        "#ad3c3e",
        "#f4eded",
        "#1c69a8",
        "#56472a"
      ];
      
      //this.canvas.addEventListener("mousewheel", this.mousewheel.bind(this), false);

      this.canvas.addEventListener("mousemove", e => {
        if (this.current_drag_data !== null) {
          this.camera.lookvec.setX(this.current_drag_data.start_cam_pos.getX() + (this.current_drag_data.start_mouse_pos.getX() - e.clientX), 50);
          this.camera.lookvec.setY(this.current_drag_data.start_cam_pos.getY() + (this.current_drag_data.start_mouse_pos.getY() - e.clientY), 50);
        }
      });
    }
    
    mousewheel(e) {
      this.camera.zoom += e.wheelDelta / 1000;
      this.camera.zoom = Math.min(Math.max(this.camera.zoom, 0.1), 1.5);
      console.log(this.camera.zoom);
    }

    update(dt, ticks) {
      if (this.dragging_movepart_info !== null) {
        if (this.selected_object_index === -1) {
          this.dragging_movepart_info = null;
        } else {
          const mp = this.camera.toWorldPos(this.mouse_pos, this.getWidth(), this.getHeight());

          let sobj = this.world.tiles[this.selected_object_index];
          let new_x = sobj.x;
          let new_y = sobj.y;
          let change_x = (mp.getX() - this.dragging_movepart_info.start_mouse_pos.getX());
          let change_y = (mp.getY() - this.dragging_movepart_info.start_mouse_pos.getY());

          const axis = this.dragging_movepart_info.axis;

          if (axis === "undetermined") {
            const dist = new rebound_common.Vector(this.dragging_movepart_info.start_obj_pos.x, this.dragging_movepart_info.start_obj_pos.y).distance(new rebound_common.Vector(new_x + change_x, new_y + change_y));
            if (dist > 20) {
              this.dragging_movepart_info.axis = Math.abs(change_x) > Math.abs(change_y) ? "x" : "y";
            }
          } else {
            if (axis === "x") {
              new_x = this.dragging_movepart_info.start_obj_pos.x + change_x;
            } else {
              new_y = this.dragging_movepart_info.start_obj_pos.y + change_y;
            }

            let decollide_itterations = 0;
            while (this.opt_move_collisions && Math.sign(axis === "x" ? change_x : change_y) !== 0 &&
              (this.check_collision(new_x + (axis === "x" ? decollide_itterations : 0), new_y + (axis === "y" ? decollide_itterations : 0), sobj.w, sobj.h, this.selected_object_index).length > 0 &&
                this.check_collision(new_x - (axis === "x" ? decollide_itterations : 0), new_y - (axis === "y" ? decollide_itterations : 0), sobj.w, sobj.h, this.selected_object_index).length > 0)
            ) {
              decollide_itterations++;
            }

            if (axis === "x") {
              new_x -= (this.check_collision(new_x + (axis === "x" ? decollide_itterations : 0), new_y + (axis === "y" ? decollide_itterations : 0), sobj.w, sobj.h, this.selected_object_index).length > 0 ? 1 : -1) * decollide_itterations;
            } else {
              new_y -= (this.check_collision(new_x + (axis === "x" ? decollide_itterations : 0), new_y + (axis === "y" ? decollide_itterations : 0), sobj.w, sobj.h, this.selected_object_index).length > 0 ? 1 : -1) * decollide_itterations;
            }

            sobj.x = Math.floor((new_x / this.opt_move_grid) + 0.5) * this.opt_move_grid;
            sobj.y = Math.floor((new_y / this.opt_move_grid) + 0.5) * this.opt_move_grid;
          }
        }
      }

      if (this.dragging_resizepart_info !== null) {
        if (this.selected_object_index === -1) {
          this.dragging_resizepart_info = null;
        } else {
          const mp = this.camera.toWorldPos(this.mouse_pos, this.getWidth(), this.getHeight());

          let sobj = this.world.tiles[this.selected_object_index];
          let new_w = sobj.w;
          let new_h = sobj.h;

          let change_x = (mp.getX() - this.dragging_resizepart_info.start_mouse_pos.getX());
          let change_y = (mp.getY() - this.dragging_resizepart_info.start_mouse_pos.getY());

          const axis = this.dragging_resizepart_info.axis;

          if (axis === "undetermined") {
            const dist = new rebound_common.Vector(this.dragging_resizepart_info.start_obj_dim.w, this.dragging_resizepart_info.start_obj_dim.h).distance(new rebound_common.Vector(new_w + change_x, new_h + change_y));
            if (dist > 20) {
              this.dragging_resizepart_info.axis = Math.abs(change_x) > Math.abs(change_y) ? "x" : "y";
            }
          } else {
            if (axis === "x") {
              new_w = this.dragging_resizepart_info.start_obj_dim.w + change_x;
            } else {
              new_h = this.dragging_resizepart_info.start_obj_dim.h + change_y;
            }

            if (new_w < 2) {
              new_w = 2;
            }

            if (new_h < 2) {
              new_h = 2;
            }

            while (this.opt_move_collisions && Math.sign(axis === "x" ? change_x : change_y) !== 0 && this.check_collision(sobj.x, sobj.y, new_w, new_h, this.selected_object_index).length > 0) {
              if (axis === "x") {
                new_w -= Math.sign(change_x);
              } else {
                new_h -= Math.sign(change_y);
              }
            }

            sobj.w = Math.floor((new_w / this.opt_move_grid) + 0.5) * this.opt_move_grid;
            sobj.h = Math.floor((new_h / this.opt_move_grid) + 0.5) * this.opt_move_grid;
          }
        }
      }
    }

    check_collision(x, y, w, h, ignore_index) {
      const collided_with = [];
      this.world.tiles.forEach((obj, i) => {
        if (i !== ignore_index && rebound_common.testrectcollision(obj.x, obj.y, obj.w, obj.h, x, y, w, h)) {
          collided_with.push({
            obj,
            i
          });
        }
      });

      return collided_with;
    }

    app_keydown(e) {
      if (this.multiselect_resolve_items !== null) {
        if (e.keyCode === 90) {
          this.multiselect_resolve_index++;
          if (this.multiselect_resolve_index >= this.multiselect_resolve_items.length) {
            this.multiselect_resolve_index = 0;
          }

          this.selected_object_index = this.multiselect_resolve_items[this.multiselect_resolve_index].i;
        }

        if (e.keyCode === 67) {
          this.multiselect_resolve_items = null;
        }
      } else {
        if (e.keyCode === 67) {
          this.opt_move_collisions = !this.opt_move_collisions;
        }
      }
      
      const numerical_keys = [49, 50, 51, 52, 53, 54, 55, 56, 57];
      this.active_color_palette.forEach((color, index) => {
        if (e.keyCode === numerical_keys[index] && this.selected_object_index !== -1) {
          const obj = this.world.tiles[this.selected_object_index];
          obj.color = color;
          
        }
      });

      if (this.selected_object_index > -1) {
        if (e.keyCode === 8) {
          this.world.tiles.splice(this.selected_object_index, 1);
          this.selected_object_index = -1;
          this.multiselect_resolve_items = null;
        }
        
        if (e.keyCode === 75) {
          const obj = this.world.tiles[this.selected_object_index];
          obj.bullet_phased = !obj.bullet_phased;
        }
        
        if (e.keyCode === 74) {
          const obj = this.world.tiles[this.selected_object_index];
          obj.reflective = !obj.reflective;
        }
        
        if (e.keyCode === 222) {
          const obj = this.world.tiles[this.selected_object_index];
          obj.visgroup = prompt("Enter visgroup", obj.visgroup === undefined ? "" : obj.visgroup);
        }
        
        if (e.keyCode === 72) {
          const obj = this.world.tiles[this.selected_object_index];
          obj.toggleable = !obj.toggleable;
        }

        if (e.keyCode === 79) {
          const obj = this.world.tiles[this.selected_object_index];

          if (typeof obj.one_way !== typeof 1) {
            obj.one_way = 0;
          } else {
            obj.one_way++;

            if (obj.one_way > 3) {
              obj.one_way = undefined;
            }
          }
        }

        if (e.keyCode === 77 && this.selected_object_index !== -1) {
          const obj = this.world.tiles[this.selected_object_index];
          const layers = ["bg", "obj", "dec"];

          obj.layer = layers[layers.indexOf(obj.layer) + 1 >= layers.length ? 0 : layers.indexOf(obj.layer) + 1];
        }
      }

      if (e.keyCode === 78) {
        this.multiselect_resolve_items = null;
        const p = this.camera.toWorldPos(new rebound_common.Vector(this.getWidth() / 2, this.getHeight() / 2), this.getWidth(), this.getHeight());
        const c = Math.floor((100 / this.opt_move_grid) + 0.5) * this.opt_move_grid;
        const new_obj = {
          x: Math.floor(((p.getX() - 50) / this.opt_move_grid) + 0.5) * this.opt_move_grid,
          y: Math.floor(((p.getY() - 50) / this.opt_move_grid) + 0.5) * this.opt_move_grid,
          w: c,
          h: c,
          color: "#0f0f0f",
          layer: "obj"
        }
        this.world.tiles.push(new_obj);
      }

      if (e.keyCode === 80) {
        const win = open("about:blank");
        console.log(JSON.stringify(this.world.tiles));

        win.onload = () => {
          const doc = win.document;

          const c = doc.createElement("pre");
          c.innerText = JSON.stringify(this.world.tiles, null, "  ");
          doc.body.appendChild(c);
        }
      }
    }

    app_keyup(e) {

    }
    
    get_active_block() {
      if (this.selected_object_index !== -1) {
        return this.world.tiles[this.selected_object_index];
      } else {
        return null;
      }
    }

    is_hovering_over_movepart() {
      const mp = this.camera.toWorldPos(this.mouse_pos, this.getWidth(), this.getHeight());
      return this.selected_object_index > -1 && mp.distance(new rebound_common.Vector(this.world.tiles[this.selected_object_index].x, this.world.tiles[this.selected_object_index].y)) <= 10;
    }

    is_hovering_over_sizepart() {
      const mp = this.camera.toWorldPos(this.mouse_pos, this.getWidth(), this.getHeight());
      return this.selected_object_index > -1 && mp.distance(new rebound_common.Vector(this.world.tiles[this.selected_object_index].x + this.world.tiles[this.selected_object_index].w, this.world.tiles[this.selected_object_index].y + this.world.tiles[this.selected_object_index].h)) <= 10;
    }

    app_mousedown(e) {
      if (e.button === 2) {
        this.current_drag_data = {
          start_mouse_pos: new rebound_common.Vector(e.clientX, e.clientY).clone(),
          start_cam_pos: this.camera.lookvec.clone()
        };

        this.canvas.style.cursor = "move";
      } else if (e.button === 0) {
        const mp = this.camera.toWorldPos(this.mouse_pos, this.getWidth(), this.getHeight());


        if (this.is_hovering_over_sizepart()) {
          this.dragging_resizepart_info = {
            start_mouse_pos: mp,
            start_obj_dim: {
              w: this.world.tiles[this.selected_object_index].w,
              h: this.world.tiles[this.selected_object_index].h
            },
            axis: "undetermined"
          }
        } else if (this.is_hovering_over_movepart()) {
          this.dragging_movepart_info = {
            start_mouse_pos: mp,
            start_obj_pos: {
              x: this.world.tiles[this.selected_object_index].x,
              y: this.world.tiles[this.selected_object_index].y
            },
            axis: "undetermined"
          }
        } else {
          const selected_objects = this.check_collision(mp.getX(), mp.getY(), 1, 1);

          if (selected_objects.length > 0) {
            if (selected_objects.length > 1) {
              this.multiselect_resolve_items = selected_objects;
              this.selected_object_index = selected_objects[0].i;
              this.multiselect_resolve_index = 0;
            } else {
              this.selected_object_index = selected_objects[0].i;
              this.multiselect_resolve_items = null;
            }
          } else {
            this.selected_object_index = -1;
            this.multiselect_resolve_items = null;
          }

        }
      }
    }

    app_mouseup(e) {
      if (e.button === 2) {
        this.current_drag_data = null;
        this.canvas.style.cursor = "default";
      }

      if (this.dragging_movepart_info !== null) {
        this.dragging_movepart_info = null;
      }

      if (this.dragging_resizepart_info !== null) {
        this.dragging_resizepart_info = null;
      }
    }

    render(ctx, w, h) {
      ctx.save();
      ctx.clearRect(0, 0, w, h);

      const mp = this.camera.toWorldPos(this.mouse_pos, w, h);


      function render(ctx, f) {
        ctx.save();
        f();
        ctx.restore();
      }

      // Editor rendering
      const guide_lines = [];
      this.camera.attach(ctx, w, h);

      render(ctx, () => {
        let selected_tile = null;
        if (this.selected_object_index > -1) {
          selected_tile = this.world.tiles[this.selected_object_index];
        }

        rebound_helpers.draw_world(ctx, w, h, this.camera, (obj, draw, i) => {
          if (rebound_common.testrectcollision(obj.x, obj.y, obj.w, obj.h, mp.getX(), mp.getY(), 1, 1) && !this.is_hovering_over_movepart() && !this.is_hovering_over_sizepart()) {
            render(ctx, _ => {
              ctx.fillStyle = "red";
              ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
            });
          } else {
            draw();
          }

          if (this.selected_object_index === i) {
            ctx.beginPath();
            ctx.arc(obj.x, obj.y, 10, 0, 2 * Math.PI);
            ctx.stroke();

            if (this.is_hovering_over_movepart()) {
              ctx.fillStyle = "red";
            } else {
              ctx.fillStyle = "orange";
            }
            ctx.fill();

            ctx.beginPath();
            ctx.arc(obj.x + obj.w, obj.y + obj.h, 10, 0, 2 * Math.PI);
            ctx.stroke();

            if (this.is_hovering_over_sizepart()) {
              ctx.fillStyle = "lime";
            } else {
              ctx.fillStyle = "green";
            }

            ctx.fill();
          }
          
          if (obj.visgroup !== undefined) {
            ctx.fillStyle = "green";
            ctx.textBaseline = "top";
            ctx.font = "20px monospace";
            ctx.fillText(obj.visgroup, obj.x, obj.y);
          }
        }, this.world);

        if (selected_tile !== null) {
          /*ctx.strokeStyle = "green";
          ctx.globalCompositeOperation = "xor";
          ctx.lineWidth = 2;
          ctx.strokeRect(selected_tile.x, selected_tile.y, selected_tile.w, selected_tile.h);*/

          ctx.fillStyle = "#fff";
          ctx.globalCompositeOperation = "xor";
          ctx.globalAlpha = 0.5;
          ctx.fillRect(selected_tile.x, selected_tile.y, selected_tile.w, selected_tile.h);
        }
      });

      rebound_helpers.draw_kill_line(ctx, this.camera, new rebound_common.Vector(w, h), rebound_common.conf.min_kill_y);

      guide_lines.forEach(guide_line => {
        render(ctx, _ => {
          ctx.beginPath();
          ctx.moveTo(guide_line.x1, guide_line.y1);
          ctx.lineTo(guide_line.x2, guide_line.y2);
          ctx.strokeStyle = "orange";
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 5;
          ctx.stroke();
        });
      });

      render(ctx, _ => {
        if (this.dragging_movepart_info !== null && this.dragging_movepart_info.axis !== "undetermined") {
          ctx.beginPath();
          ctx.moveTo(this.dragging_movepart_info.start_obj_pos.x, this.dragging_movepart_info.start_obj_pos.y);
          ctx.lineTo(this.dragging_movepart_info.axis === "x" ? mp.getX() : this.dragging_movepart_info.start_obj_pos.x, this.dragging_movepart_info.axis === "y" ? mp.getY() : this.dragging_movepart_info.start_obj_pos.y);
          ctx.strokeStyle = "red";
          ctx.globalCompositeOperation = "xor";
          ctx.lineWidth = 5;
          ctx.stroke();
        }
      });

      this.camera.dettach(ctx, w, h);

      render(ctx, () => {
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, w, 50);

        ctx.fillStyle = "#fff";

        ctx.font = "15px Ubuntu Mono";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";

        ctx.fillText("HeatEdit v1 | N: New object | Left click: Select | Drag right click: Pan", 10, 25);
        ctx.textAlign = "right";
        ctx.fillText("P: Publish | E: JSON editor", w - 10, 25);
      });

      // Multiselect resolution
      render(ctx, () => {
        if (this.multiselect_resolve_items !== null) {
          ctx.font = "15px Ubuntu Mono";
          ctx.textBaseline = "middle";
          ctx.globalCompositeOperation = "xor";
          ctx.textAlign = "center";

          ctx.fillText("Multiple objects in same place. Press z to cycle, c to close.", w / 2, h - 100);
        }
      });

      render(ctx, () => {
        ctx.font = "15px Ubuntu Mono";
        ctx.textBaseline = "bottom";
        ctx.globalCompositeOperation = "xor";
        ctx.textAlign = "left";

        ctx.fillText("Move Collisions: " + this.opt_move_collisions + " [Toggle using C] || Grid: " + this.opt_move_grid + " || Zoom: " + Math.floor(this.camera.zoom * 100) / 100 + "              || OBJS: " + rebound_helpers.get_culled(this.camera, w, h, rebound_common.world).length, 20, h - 20);
        
        let active_block = this.get_active_block();
        if (active_block !== null) {
          ctx.fillText(`X: ${active_block.x} Y: ${active_block.y}  ||  W: ${active_block.w} H: ${active_block.h}`, 20, h - 40);
        }
      });

      ctx.restore();
    }
  }

  rebound_common.apply_config(rebound_config);
  window.addEventListener('load', function() {
    const canvas = document.createElement('canvas');
    canvas.style.background = "radial-gradient(rgb(255, 255, 255), rgb(222, 228, 232))";
    new Editor(canvas);
    document.body.appendChild(canvas);
  });
}());