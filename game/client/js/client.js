(function() {
  const socket = io();

  class Game extends rebound_helpers.CanvasApplication {
    // Application code
    init() {
      console.log("This project is open sourced. If you want to see the source code, head over to https://github.com/Radbuglet/heat-gun-proto");

      this.last_ping = -719;
      this.gun_dir = new rebound_common.Vector(0, 1);
      this.gun_anim_back = 0;
      this.death_reason = [];
      this.state = "menu";
      this.power_up_crystal_data = [];
      this.cloud_horizon = new rebound_helpers.CloudHorizon(this.ctx);
      this.draw_3d = window.localStorage.opt_use_3d == "1" || window.localStorage.opt_use_3d == null;

      this.player = null;
      this.other_players = {};
      this.camera = new rebound_helpers.Camera(new rebound_common.Vector(0, 0));
      this.selected_weapon_index = 0;
      this.selected_trait_edit_index = 0;
      this.chat_messages = [
        [{
          color: "#5c5c5c",
          text: '==='
        }, {
          color: "#ce0c0c",
          text: " [Heat gun] "
        }, {
          color: "#5c5c5c",
          text: '==='
        }]
      ];

      // Socket.io
      socket.on('resp_play', data => {
        this.player = new rebound_common.Player(data.username);
        this.player.position.setX(data.spawnX);
        this.player.position.setY(data.spawnY);
        this.camera.lookvec.setX(data.spawnX);
        this.camera.lookvec.setY(data.spawnY);
        this.state = "game";
        
        this.canvas.style.animation = 'spawn 0.25s';
      });

      socket.on('new_message', msg => {
        this.chat_messages.push(msg);
        this.chat_messages.reverse();
        this.chat_messages = this.chat_messages.slice(0, 10);
        this.chat_messages.reverse();
      });

      socket.on('add_beams', beams_list => {
        beams_list.forEach(beam_pkt => {
          let beam = {
            path: beam_pkt.beam_path,
            size: beam_pkt.beam_size,
            exist_until: Date.now() + 1000
          }
          this.beams.push(beam);
        });
      });

      socket.on('heartbeat', data => {
        const sv_dt = rebound_common.get_net_ts() - data.svr_timestamp;
        const sv_ticks = sv_dt / ((1 / 60) * 1000);

        this.last_ping = sv_dt;

        if (data.power_up_crystal_data instanceof Array) {
            this.power_up_crystal_data = data.power_up_crystal_data;
        }

        data.player_data.forEach(player_data => {
          let player;

          if (player_data.pub_uuid === data.my_pub_uuid) {
            player = this.player;
          } else {
            if (this.other_players[player_data.pub_uuid] !== undefined) {
              player = this.other_players[player_data.pub_uuid];
            } else {
              this.other_players[player_data.pub_uuid] = new rebound_common.Player(player_data.name);
            }
          }

          if (player !== undefined && player !== null) {

            player.position.setX(player_data.pX);
            player.position.setY(player_data.pY);

            player.velocity.setX(player_data.vX);
            player.velocity.setY(player_data.vY);

            player.health = player_data.health;
            player.energy = player_data.energy;
            player.weapons = player_data.weapons;
            player.lowered_phys = player_data.lowered_phys;
            player.death_reason = player_data.death_reason;
            player.power_up_slot = player_data.power_up_slot;
            player.current_power_up = player_data.current_power_up;
            player.power_up_time_left = player_data.power_up_time_left;
            rebound_common.apply_physics(player, sv_ticks);
          }
        });

        for (let pub_uuid in this.other_players) {
          if (data.player_data.filter(d => d.pub_uuid === pub_uuid).length === 0) {
            delete this.other_players[pub_uuid];
          }
        }
      });
    }

    update(dt, ticks) {
      if (this.state === "game") {
        if (this.player == null || this.player.health <= 0) {
          this.state = "menu";

          this.death_reason = this.player !== null ? this.player.death_reason : [];
          console.log(this.player.death_reason);
        } else {
          rebound_common.apply_physics(this.player, rebound_common.round(Math.min(ticks, 3), 2));

          for (let key in this.other_players) {
            let plr = this.other_players[key];
            rebound_common.apply_physics(plr, rebound_common.round(Math.min(ticks, 3), 2));
          }

          this.camera.lookvec.setX(this.player.client_interp_position.getX(), 50);
          this.camera.lookvec.setY(this.player.client_interp_position.getY(), 50);

          const center = new rebound_common.Vector(this.getWidth() / 2 + rebound_common.conf.player_size / 2, this.getHeight() / 2 + rebound_common.conf.player_size / 2);
          this.gun_dir = this.mouse_pos.sub(center).normalized();
        }
      } else if (this.state === "menu") {
        if ((this.keys[32] || this.keys[13]) && this.last_open_play_dialog + 100 < Date.now()) {
          this.last_open_play_dialog = Date.now();
          const username = this.keys[13] && localStorage.prev_username ? localStorage.prev_username : prompt("Player name:", localStorage.prev_username || "");
          this.keys[32] = false;

          if (username !== null) {
            localStorage.prev_username = username;

            const name_err = rebound_common.is_valid_username(username);

            if (name_err !== null) {
              alert("Problem with username: " + name_err);
            } else {
              socket.emit('play', username);
              this.state = "connecting";
            }
          }
        }
      }
    }

    app_keydown(e) {
      let rush_pkt_dir = null;

      if (e.metaKey) return;
      let nums = [
        "1", "2", "3", "4", "5", "6", "7", "8", "9"
      ].forEach((key_id, index) => {
        if (index < this.player.weapons.length) {
          if (e.key === key_id) {
            this.selected_weapon_index = index;
          }
        }
      });

      if (this.player !== null) {
        if (e.code === "KeyR" && !e.shiftKey) {
          this.draw_3d = !this.draw_3d;
          window.localStorage.opt_use_3d = this.draw_3d ? "1" : "0";
        }

        if (e.code === "Space") {
          socket.emit('set_lowered_phys', true);
        }
        
        if (this.player.power_up_slot !== null && e.code === "KeyP") {
          socket.emit('use_power_up');
        }
        
        if (e.key === "ArrowUp") {
          this.selected_trait_edit_index--;
        }

        if (e.key === "ArrowDown") {
          this.selected_trait_edit_index++;
        }

        if (e.key === "ArrowLeft") {
          socket.emit("trait_change", {
            weapon: this.selected_weapon_index,
            trait: this.selected_trait_edit_index,
            is_increase: false
          });
        }

        if (e.key === "ArrowRight") {
          socket.emit("trait_change", {
            weapon: this.selected_weapon_index,
            trait: this.selected_trait_edit_index,
            is_increase: true
          });
        }

        if (this.selected_trait_edit_index < 0) {
          this.selected_trait_edit_index = rebound_common.weapon_configurables.length - 1;
        }

        if (this.selected_trait_edit_index >= rebound_common.weapon_configurables.length) {
          this.selected_trait_edit_index = 0;
        }

        if (e.keyCode === 65) {
          rush_pkt_dir = "left";
        }

        if (e.keyCode === 68) {
          rush_pkt_dir = "right";
        }

        if (e.keyCode === 87) {
          rush_pkt_dir = "up";
        }

        if (e.keyCode === 83) {
          rush_pkt_dir = "down";
        }

        if (rush_pkt_dir !== null) {
          socket.emit('rush', rush_pkt_dir);
        }
      }
    }

    app_keyup(e) {
      if (this.player !== null) {
        if (e.keyCode === 32 || e.keyCode === 16) {
          socket.emit('set_lowered_phys', false);
        }
      }
    }

    render(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);

      function rdiff() {
        return Math.floor(Math.random() * 100) - 50;
      }

      if (this.state !== "game") {
        if (this.state === "menu") {
          ctx.save();
          ctx.fillStyle = "#1a1a1a";
          ctx.beginPath();
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w / 2 + 10, h);
          ctx.lineTo(w, h);
          ctx.lineTo(w, 0);
          ctx.fill();
          ctx.restore();

          ctx.save();
          ctx.font = "100px bangers";

          ctx.strokeStyle = `rgb(${255 - rdiff()}, ${100 - rdiff()}, ${rdiff()})`;
          ctx.lineWidth = 10;
          ctx.strokeText("Heat Gun", 100, 200);
          ctx.restore();

          ctx.save();
          ctx.font = "50px bangers";

          ctx.fillStyle = `rgb(255, 200, 100)`;
          ctx.fillText("Press space to play!", 100, 270);
          ctx.restore();

          ctx.save();
          rebound_helpers.draw_text_colored(ctx, rebound_common.conf.title_screen_instructions, w / 2 + 40, 100, "20px monospace", 25, true);

          if (this.death_reason.length > 0) {
            rebound_helpers.draw_text_colored(ctx, this.death_reason, 100, 400, "30px bangers", 25, true);
          }
          ctx.restore();
        } else if (this.state === "connecting") {
          ctx.save();
          ctx.font = "30px monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          ctx.fillStyle = "#35428a";
          ctx.fillText("Waiting...", w / 2, h * 0.30 + 2);
          ctx.restore();
        }
        return;
      }

      // Background
      this.cloud_horizon.draw();

      // Scene rendering
      this.camera.attach(ctx, w, h);

      // Render world
      rebound_helpers.draw_world(ctx, w, h, this.camera, undefined, undefined, this.draw_3d);

      rebound_helpers.draw_crystals(ctx, this.power_up_crystal_data, this.total_frames);

      rebound_helpers.draw_player(ctx, this.player);

      for (let player_pub_uuid in this.other_players) {
        const player = this.other_players[player_pub_uuid];
        rebound_helpers.draw_player(ctx, player, true);
        /*const is_on_ground = rebound_common.is_on_ground(player.position);
        rebound_helpers.draw_gun(ctx, player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2)),
          ((!is_on_ground) ? player.velocity.normalized() :
            new rebound_common.Vector(Math.sin(rebound_common.torad(this.total_frames)), Math.cos(rebound_common.torad(this.total_frames)))
          )
          .mult(new rebound_common.Vector(30, 30)), is_on_ground);*/
      }

      let del_list = []
      let temp_beams = [];
      this.beams.forEach((beam, i) => {
        ctx.save();
        ctx.strokeStyle = "red";
        ctx.lineWidth = beam.size * 2;
        if (!(beam.path[0] instanceof rebound_common.Vector) && beam.path[1] !== undefined) {
          beam.path[0] = new rebound_common.Vector(beam.path[0].pX, beam.path[0].pY);
          const bdst = beam.path[0].distance(new rebound_common.Vector(beam.path[1].pX, beam.path[1].pY)) * 0.2;
          beam.path[0].setX(beam.path[1].pX, bdst);
          beam.path[0].setY(beam.path[1].pY, bdst);
        }

        if (beam.path[1] !== undefined) {
          ctx.beginPath();
          ctx.moveTo(beam.path[0].getX(), beam.path[0].getY());
          beam.path.forEach((p, i) => {
            if (i > 0) {
              ctx.lineTo(p.pX, p.pY);
            }
          });
          ctx.stroke();
        }

        ctx.restore();

        if (beam.path[1] !== undefined && beam.path[0]._x.start_time + beam.path[0]._x.duration < Date.now()) {
          beam.path.splice(0, 1);
          if (beam.path[1] === undefined || beam.path[0] === undefined) {
            del_list.push(i);
          }
        }

        if (beam.path[1] !== undefined) {
          temp_beams.push(beam);
        }

      });

      this.beams = temp_beams;

      const center = new rebound_common.Vector(w / 2 + rebound_common.conf.player_size / 2, h / 2 + rebound_common.conf.player_size / 2);
      const v = this.gun_dir;
      center.mutadd(v.mult(new rebound_common.Vector(this.gun_anim_back, this.gun_anim_back)));
      const disp_v = v.mult(new rebound_common.Vector(30, 30));

      if (this.player.lowered_phys) {
        ctx.save();
        ctx.globalCompositeOperation = "xor";
        ctx.strokeStyle = "red";
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 5;
        ctx.beginPath();
        let p = this.player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2));

        ctx.moveTo(p.getX(), p.getY());
        p.mutadd(this.gun_dir.mult(new rebound_common.Vector(5000, 5000)));
        ctx.lineTo(p.getX(), p.getY());
        ctx.stroke();

        ctx.restore();
      }

      rebound_helpers.draw_gun(ctx,
        this.player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2)).sub(v.mult(new rebound_common.Vector(this.gun_anim_back, this.gun_anim_back))), disp_v);
      rebound_helpers.draw_kill_line(ctx, this.camera, new rebound_common.Vector(w, h), rebound_common.conf.min_kill_y);

      this.camera.dettach(ctx);

      // UI rendering
      rebound_helpers.draw_player_localizer(ctx, this, new rebound_common.Vector(0, 0), new rebound_common.Vector(0, 30), new rebound_common.Vector(1, 0), h / 30, true);
      rebound_helpers.draw_player_localizer(ctx, this, new rebound_common.Vector(w, 0), new rebound_common.Vector(0, 30), new rebound_common.Vector(-1, 0), h / 30, false);

      
      ctx.save();
      const ammo_w = 100;
      const bar_w = this.getWidth() / 3;
      const ammo_bar_padd = 25;

      const total_btm_w = ammo_bar_padd + ammo_w + bar_w;

      const bar_x = w / 2 - total_btm_w / 2;
      const ammo_px = bar_x + bar_w + ammo_bar_padd;

      const ammo_py = h - 100;
      const bar_y = ammo_py + 5;

      for (let hpl = 0; hpl < 20; hpl++) {
        const wid = (bar_w / 20);
        const pos = bar_x + hpl * wid;
        const col = rebound_common.hslToRgb((hpl / 50 + Date.now() / 10000) % 1, 
          hpl <= Math.floor(this.player.health) ? 0.9 : 0.05,
          0.5);
        
        const col_shadow = rebound_common.hslToRgb((hpl / 50 + Date.now() / 10000) % 1, 
          hpl <= Math.floor(this.player.health) ? 0.9 : 0.05,
          0.4);

        ctx.fillStyle = `rgb(${col_shadow.join(',')})`;
        ctx.fillRect(pos, bar_y, wid, 40);

        ctx.fillStyle = `rgb(${col.join(',')})`;
        ctx.fillRect(pos, bar_y, wid, 36);
      }

      ctx.restore();
      

      ctx.save();
      ctx.fillStyle = "#3f3d3fdd";
      ctx.fillRect(ammo_px, ammo_py, 100, 50);

      ctx.fillStyle = "#fff";
      ctx.font = "20px monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(this.player.weapons[this.selected_weapon_index].ammo + "⁌", ammo_px + (100 / 2), ammo_py + (50 / 2));
      ctx.restore();







      ctx.save();
      ctx.fillStyle = "#3f51b5";
      ctx.font = "15px monospace";
      ctx.textAlign = "start";
      ctx.textBaseline = "top";
      ctx.fillText("Unspent energy: " + Math.round(this.player.energy), 10, 40);
      ctx.restore();

      ctx.save();
      rebound_helpers.draw_text_colored(ctx, this.chat_messages, 10, h - 100 - (this.chat_messages.length * 17), "15px monospace", 17, true);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "#3f51b5";
      ctx.font = "15px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("FPS: " + this.fps, w, 0);
      ctx.restore();

      ctx.save();

      // Weapons list
      ctx.save();
      const weapon_item_width = 250;
      const weapon_item_height = 50;
      const weapon_item_in_between = 20;
      const weapon_ui_padding = 50;

      const weapons_start = h - (this.player.weapons.length * (weapon_item_height + weapon_item_in_between)) - weapon_ui_padding;
      const weapon_x_pos = w - weapon_item_width - weapon_ui_padding;

      this.player.weapons.forEach((weapon, index) => {
        ctx.save();
        ctx.fillStyle = this.selected_weapon_index === index ? `hsl(${Date.now() / 20}deg, 30%, 50%)` : `#3f3d3fdd`;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        const weapon_y_coord = weapons_start + (weapon_item_height + weapon_item_in_between) * index;

        ctx.strokeRect(weapon_x_pos, weapons_start + (weapon_item_height + weapon_item_in_between) * index, weapon_item_width, weapon_item_height);
        ctx.fillRect(weapon_x_pos, weapons_start + (weapon_item_height + weapon_item_in_between) * index, weapon_item_width, weapon_item_height);

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.font = "15px monospace";
        ctx.fillText(
          index + 1 + " | +" + weapon.conf.additional_callibur + " Pow +" + weapon.conf.additional_barrels + " Barrels",
          weapon_x_pos + 15, weapon_y_coord + weapon_item_height / 2);
        ctx.restore();
      });



      const traits_visible = 3;
      const weapon_traitconf_item_width = 250;
      const weapon_traitconf_item_height = 80;
      const weapon_traitconf_item_in_between = 20;
      const weapon_traitconf_padding = 50;
      const weapon_traitconf_x_pos = w - weapon_traitconf_item_width - weapon_traitconf_padding;

      const weapons_traitconf_start = weapons_start - (traits_visible * (weapon_traitconf_item_height + weapon_traitconf_item_in_between)) - weapon_traitconf_padding;

      rebound_common.weapon_configurables.forEach((configurable, index) => {
        if (Math.abs(index - this.selected_trait_edit_index) > 1) return;
        const vis_index = index - this.selected_trait_edit_index;
        ctx.save();
        ctx.fillStyle = this.selected_trait_edit_index === index ? `hsl(${Date.now() / 20}deg, 10%, 30%)` : "#3f3d3fdd";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        const y_coord = weapons_traitconf_start + (weapon_traitconf_item_height + weapon_traitconf_item_in_between) * vis_index;

        ctx.strokeRect(weapon_traitconf_x_pos, weapons_traitconf_start + (weapon_traitconf_item_height + weapon_traitconf_item_in_between) * vis_index, weapon_traitconf_item_width, weapon_traitconf_item_height);
        ctx.fillRect(weapon_traitconf_x_pos, weapons_traitconf_start + (weapon_traitconf_item_height + weapon_traitconf_item_in_between) * vis_index, weapon_traitconf_item_width, weapon_traitconf_item_height);
        
        if (index == 0 || index == rebound_common.weapon_configurables.length - 1) {

          ctx.fillStyle = "#171717";
          ctx.fillRect(weapon_traitconf_x_pos, ((index == 0) ? (y_coord - 75) : (y_coord + 50 + weapon_traitconf_item_height)) + 5, weapon_traitconf_item_width, 25);

          ctx.fillStyle = "#232323";
          ctx.fillRect(weapon_traitconf_x_pos, ((index == 0) ? (y_coord - 75) : (y_coord + 50 + weapon_traitconf_item_height)), weapon_traitconf_item_width, 25);
        }

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.font = "15px monospace";
        rebound_helpers.draw_text_colored(ctx, [
          [{
            color: "#FF5555",
            text: configurable.name
          }],
          [{
            color: "#AAAAAA",
            text: "Each upgrade costs: " + configurable.cost
          }],
          new Array(configurable.maxval).fill({
            color: "red",
            text: "ERR"
          }).map((_, i) => {
            return i < this.player.weapons[this.selected_weapon_index].conf[configurable.key] ? {
              color: highlight_color,
              text: "▉"
            } : {
              color: "gray",
              text: "▉"
            }
          }).concat([{
            color: highlight_color,
            text: " " + this.player.weapons[this.selected_weapon_index].conf[configurable.key] + " / " + configurable.maxval
          }])
        ], weapon_traitconf_x_pos + 20, y_coord + 20, "monospace 15px", 20, true);
        ctx.restore();
      });

      ctx.restore();


      // @TODO put in update
      if (this.mousedown && this.gun_anim_back < 5) {
        socket.emit("gun", {
          dir: Math.atan2(this.gun_dir.getX(), this.gun_dir.getY()),
          selected_weapon: this.selected_weapon_index
        });
        this.gun_anim_back = 15 + (this.player.weapons[this.selected_weapon_index].conf.additional_callibur * 5);
      }

      ctx.restore();

      if (this.gun_anim_back > 0) {
        this.gun_anim_back--;
      }
      
      if (this.player.power_up_slot !== null || this.player.current_power_up !== null) {
        const power_up_type = rebound_common.powerup_types[this.player.power_up_slot || this.player.current_power_up];
        ctx.save();
        ctx.fillStyle = power_up_type.bg_color;
        ctx.fillRect(w / 2 - 100, 0, 200, 125);

        ctx.fillStyle = `rgba(0, 0, 0, 0.25)`;
        ctx.fillRect(w / 2 - 100, 100, 200, 25);
        
        ctx.strokeStyle = `hsl(${Date.now() / 20}deg, 100%, 90%)`;
        ctx.lineWidth = Math.sin(Date.now() / 100) + 1.5;
        ctx.font = "20px Bangers";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(power_up_type.name, w / 2, 0 + 50);
        
        if (this.player.power_up_slot !== null) {
          ctx.strokeText("Press P to use", w / 2, 100 + 14);
        } else {
          ctx.fillText(this.player.power_up_time_left + "s left", w / 2, 100 + 14);
          ctx.strokeText(this.player.power_up_time_left + "s left", w / 2, 100 + 14);
        }
        
        ctx.restore();
      }
    }
  }

  rebound_common.apply_config(rebound_config);
  window.addEventListener('load', function() {
    const canvas = document.createElement('canvas');
    canvas.style.background = "radial-gradient(rgb(255, 255, 255), rgb(222, 228, 232))";
    new Game(canvas);
    document.body.appendChild(canvas);
  });

  socket.on('disconnect', _ => {
    //alert("You were disconnect from the server. This tab will reload after pressing ok.");
    //window.location.reload();
  });
}());