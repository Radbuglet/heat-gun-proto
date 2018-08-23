(function() {
  const socket = io();

  class Game extends rebound_helpers.CanvasApplication {
    // Application code
    init() {
      console.log("This project is open sourced. If you want to see the source code, head over to https://github.com/Radbuglet/heat-gun-proto");

      this.last_ping = -719;
      this.latest_heartbeat_packet = 0;
      this.action_unk_count = 0;
      this.gun_dir = new rebound_common.Vector(0, 1);
      this.gun_anim_back = 0;
      this.death_reason = [];
      this.state = "menu";
      this.player_action_ack_id = null;
      this.power_up_crystal_data = [];
      this.cloud_horizon = new rebound_helpers.CloudHorizon(this.ctx);
      this.draw_3d = window.localStorage.opt_use_3d == "1" || window.localStorage.opt_use_3d == null;

      this.player = null;
      this.other_players = {};
      this.camera = new rebound_helpers.Camera(new rebound_common.Vector(0, 0));
      this.selected_weapon_index = 0;
      this.selected_trait_edit_index = 0;

      this.leaderboard_json = null;
      this.refresh_leaderboard();

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

        if (this.latest_heartbeat_packet > data.svr_timestamp) {
          console.warn("A latent heartbeat packet has arrive and has been ignored.");
          return;
        }

        this.latest_heartbeat_packet = data.svr_timestamp;

        if (sv_dt <= 0) {
          console.warn("Ping is somehow negative? Ping: ", sv_dt, " | Server sent at: ", data.svr_timestamp, " Client recieved at: ", rebound_common.get_net_ts());
        }
        const sv_ticks = sv_dt / ((1 / 60) * 1000);

        this.my_pub_uuid = data.my_pub_uuid

        this.last_ping = sv_dt;

        if (data.power_up_crystal_data instanceof Array) {
          this.power_up_crystal_data = data.power_up_crystal_data;
        }

        data.player_data.forEach(player_data => {
          let player;

          if (player_data.pub_uuid === data.my_pub_uuid) {
            player = this.player;
            
            if (this.player_action_ack_id !== null && this.player_action_ack_id !== player_data.action_ack_id && this.action_unk_count > 4) {
              console.warn("Refusing to update own player, heartbeat doesn't acknowledge action. HB ACK ID =", player_data.action_ack_id, " CLI ACK ID =", this.player_action_ack_id);
              this.action_unk_count += 1;
              return;
            }

            this.player_action_ack_id = null;
            this.action_unk_count = 0;
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
            player.total_energy = player_data.total_energy;
            player.weapons = player_data.weapons;
            player.lowered_phys = player_data.lowered_phys;
            player.death_reason = player_data.death_reason;
            player.power_up_slot = player_data.power_up_slot;
            player.current_power_up = player_data.current_power_up;
            player.power_up_time_left = player_data.power_up_time_left;

            // Temporarily disabled due to buggy timestamps
            // rebound_common.apply_physics(player, sv_ticks);
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

          this.refresh_leaderboard();
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
      }
    }

    app_keydown(e) {
      let rush_pkt_dir = null;

      if (e.metaKey) return;

      if (this.state === "menu" && (e.code === "Enter" || e.code === "Space")) {
        const username = e.code === "Enter" && localStorage.prev_username ? localStorage.prev_username : prompt("Player name:", localStorage.prev_username || "");
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

      if (this.player !== null) {
        let nums = [
          "1", "2", "3", "4", "5", "6", "7", "8", "9"
        ].forEach((key_id, index) => {
          if (index < this.player.weapons.length) {
            if (e.key === key_id) {
              this.selected_weapon_index = index;
            }
          }
        });

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
          this.cloud_horizon.draw(this.getHeight());

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
          ctx.font = "150px bangers";

          ctx.strokeStyle = `rgb(${255 - rdiff()}, ${100 - rdiff()}, ${rdiff()})`;
          ctx.lineWidth = 10;
          ctx.textAlign = "center";
          ctx.translate(w * 0.25, h * 0.4);
          ctx.rotate(Math.sin(Date.now() / 255) * 0.01);
          ctx.strokeText("Heat Gun", 0, 0);
          ctx.restore();

          ctx.save();
          ctx.font = "24px bangers";
          ctx.textAlign = "center";

          ctx.fillStyle = `hsl(${Date.now() / 20}deg, 75%, 40%)`;
          ctx.fillText("Press space to play!".split("").join(String.fromCharCode(8202) + String.fromCharCode(8202) + String.fromCharCode(8202) + String.fromCharCode(8202)), w * 0.25, h - 255);
          ctx.restore();

          ctx.save();

          let welcome_screen_text = rebound_common.conf.title_screen_instructions;

          welcome_screen_text = welcome_screen_text.concat([
            [{
                "color": "yellow",
                "text": "==>"
              },
              {
                "color": "THEME_IMPORTANT",
                "text": " Leaderboard "
              },
              {
                "color": "",
                "text": " "
              },
              {
                "color": "yellow",
                "text": "Refesh",
                "click_action": () => {
                  this.refresh_leaderboard();
                },
                "click_underline": "gold"
              }
            ],
            []
          ]);

          if (this.leaderboard_json !== null) {
            const current_leaderboard = this.leaderboard_json[0].scores;

            welcome_screen_text = welcome_screen_text.concat(current_leaderboard.filter((_, i) => i < 10).map((fc_score, i) => {
              function generate_score_text(score_item, num) {
                return [{
                    "color": "#3f3d3fdd",
                    "text": " " + ((num.toString().length !== 2) ? "0" : "") + num + " ",
                    "bg": "THEME_IMPORTANT"
                  },
                  {
                    "bg": "#3f3d3fdd",
                    "color": "THEME_IMPORTANT",
                    "text": " " + score_item.score + " "
                  },
                  {
                    "bg": "#3f3d3fdd",
                    "color": "#FF5555",
                    "text": " " + score_item.name.substring(0, 15) + " "
                  }
                ];
              }
              const sc_score = current_leaderboard[i + 10];
              let text = generate_score_text(fc_score, i + 1);
              const spacing_text = new Array(30 - text.reduce((sum, t) => sum + t.text.length, 0)).join(" ");
              if (sc_score) text = text.concat([{
                "color": "red",
                "text": spacing_text
              }]).concat(generate_score_text(sc_score, i + 11));

              return text;
            }));
          } else {
            welcome_screen_text = welcome_screen_text.concat([
              [{
                text: "Loading...",
                color: "THEME_IMPORTANT"
              }]
            ])
          }

          rebound_helpers.draw_text_colored(this, ctx, welcome_screen_text, w / 2 + 40, 100, "20px monospace", 25, true);

          if (this.death_reason.length > 0) {
            rebound_helpers.draw_text_colored(this, ctx, this.death_reason, 100, 400, "30px bangers", 25, true);
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
      this.cloud_horizon.draw(this.getHeight());

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

      const gun_pos = this.player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2));

      if (this.player.lowered_phys) {
        ctx.save();
        ctx.globalCompositeOperation = "xor";
        ctx.strokeStyle = "red";
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 5;
        ctx.beginPath();

        ctx.moveTo(gun_pos.getX(), gun_pos.getY());
        const gun_laser_end = gun_pos.clone();
        gun_laser_end.mutadd(this.gun_dir.mult(new rebound_common.Vector(5000, 5000)));
        ctx.lineTo(gun_laser_end.getX(), gun_laser_end.getY());
        ctx.stroke();

        ctx.restore();
      }

      rebound_helpers.draw_gun(ctx, gun_pos, this.get_gun_dir_vec().mult(new rebound_common.Vector(30, 30)));


      rebound_helpers.draw_kill_line(ctx, this.camera, new rebound_common.Vector(w, h), rebound_common.conf.min_kill_y);

      this.camera.dettach(ctx);

      // UI rendering
      rebound_helpers.draw_player_localizer(ctx, this, new rebound_common.Vector(0, 0), new rebound_common.Vector(0, 30), new rebound_common.Vector(1, 0), h / 30, true);
      rebound_helpers.draw_player_localizer(ctx, this, new rebound_common.Vector(w, 0), new rebound_common.Vector(0, 30), new rebound_common.Vector(-1, 0), h / 30, false);

      // Some test code

      /*Object.values(this.other_players).forEach(oplayer => {
        const adist = oplayer.position.sub(this.player.position).getdeg() - this.get_gun_dir_deg();

        ctx.save();
        ctx.fillStyle = "red";
        ctx.fillRect(w / 2 + adist - 50, 100, 50, 50);

        ctx.restore();
      });*/



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
      rebound_helpers.draw_text_colored(this, ctx, this.chat_messages, 10, h - 100 - (this.chat_messages.length * 17), "15px monospace", 17, true);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "#3f51b5";
      ctx.font = "15px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";

      function generate_ctext_indicator(name, value, additional_bspaces) {
        const expected_length = 13;
        const text_length = (" " + name + ": " + new Array(additional_bspaces || 0).fill(" ").join("") + value + " ").length - 1;

        return [{
            "color": "#FF5555",
            "bg": "#3f3d3fdd",
            "text": " " + name + ": " + new Array(additional_bspaces || 0).fill(" ").join("")
          },
          {
            "color": "THEME_IMPORTANT",
            "bg": "#3f3d3fdd",
            "text": value + " "
          },
          {
            "color": "#fff",
            "text": new Array(Math.max(expected_length - text_length, 1)).fill(" ").join("")
          }
        ]
      }

      const char_disp = 13 * 2 + 1;
      const leaderboard = Object.values(this.other_players).concat([this.player]).sort(function(a, b) {
        return b.total_energy - a.total_energy;
      });

      let player_placing = "...";
      const leaderboard_text = leaderboard.map((player, i) => {
        if (player == this.player) {
          player_placing = i + 1;
        }
        if (i > 9) {
          return;
        }
        return [{
            color: "#3f3d3fdd",
            text: " " + (i + 1) + " ",
            bg: "THEME_IMPORTANT"
          },
          {
            color: "#FF5555",
            text: " " + player.name.substring(0, 15) + " ",
            bg: "#3f3d3fdd"
          },
          {
            color: "#fff",
            text: new Array(char_disp - player.name.substring(0, 15).length - 5).fill(" ").join("")
          },
          {
            color: "#3f3d3fdd",
            text: " " + Math.round(player.total_energy) + " ",
            bg: "THEME_IMPORTANT"
          },
        ]
      });
      const players_online = Object.keys(this.other_players).length + 1;
      const your_place_text_length = (" YOU  " + player_placing + " ").length - 1;
      rebound_helpers.draw_text_colored(this, ctx, [
        generate_ctext_indicator("FPS", this.fps).concat(generate_ctext_indicator("PING", this.last_ping, 2)),
        generate_ctext_indicator("OBJ", rebound_helpers.get_culled(this.camera, w, h, rebound_common.world).length).concat(generate_ctext_indicator("ONLINE", Array(3 - players_online.toString().length).fill("0").join("") + players_online)), [],
        generate_ctext_indicator("PTS", Math.round(this.player.total_energy)).concat(generate_ctext_indicator("ENERGY", Math.round(this.player.energy))), [],
        [{
            color: "#3f3d3fdd",
            text: " >>> ",
            bg: "THEME_IMPORTANT"
          },
          {
            color: "#FF5555",
            text: " LEADERBOARD ",
            bg: "#3f3d3fdd"
          },
          {
            color: "#fff",
            text: new Array(Math.max(char_disp - 18 - your_place_text_length, 1)).fill(" ").join("")
          },
          {
            color: "#FF5555",
            text: " YOU ",
            bg: "#3f3d3fdd"
          },
          {
            color: "#3f3d3fdd",
            text: " " + player_placing + " ",
            bg: "THEME_IMPORTANT"
          },
        ],
        []
      ].concat(
        leaderboard_text
      ), 10, 0, "15px monospace", 17, true);

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
        function draw_hint_key(char, x, y) {
          ctx.save();
          ctx.fillStyle = "#eee";
          ctx.strokeStyle = "#a0a0a0";
          ctx.lineWidth = 3;
          ctx.strokeRect(x - 15, y - 15, 30, 30);
          ctx.fillRect(x - 15, y - 15, 30, 30);
          ctx.restore();

          ctx.save();
          ctx.fillStyle = "#000";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = "18px sans-serif";
          ctx.fillText(char, x, y);
          ctx.restore();
        }

        if (Math.abs(index - this.selected_trait_edit_index) > 1) return;

        const vis_index = index - this.selected_trait_edit_index;
        const y_coord = weapons_traitconf_start + (weapon_traitconf_item_height + weapon_traitconf_item_in_between) * vis_index;

        ctx.save();
        ctx.fillStyle = this.selected_trait_edit_index === index ? `hsl(${Date.now() / 20}deg, 10%, 30%)` : "#3f3d3fdd";


        const arrow_characters_center_y = y_coord + weapon_traitconf_item_height / 2;
        if (this.selected_trait_edit_index === index) {
          ctx.save();

          draw_hint_key("⇧", weapon_traitconf_x_pos - 40, arrow_characters_center_y - 25 - Math.sin(Date.now() / 255) * 3);

          draw_hint_key("⇩", weapon_traitconf_x_pos - 40, arrow_characters_center_y + 25 + Math.sin(Date.now() / 255) * 3);
          ctx.restore();
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;

        ctx.strokeRect(weapon_traitconf_x_pos, y_coord, weapon_traitconf_item_width, weapon_traitconf_item_height);
        ctx.fillRect(weapon_traitconf_x_pos, y_coord, weapon_traitconf_item_width, weapon_traitconf_item_height);

        if (index === 0 || index == rebound_common.weapon_configurables.length - 1) {

          ctx.fillStyle = "#171717";
          ctx.fillRect(weapon_traitconf_x_pos, ((index === 0) ? (y_coord - 75) : (y_coord + 50 + weapon_traitconf_item_height)) + 5, weapon_traitconf_item_width, 25);

          ctx.fillStyle = "#232323";
          ctx.fillRect(weapon_traitconf_x_pos, ((index === 0) ? (y_coord - 75) : (y_coord + 50 + weapon_traitconf_item_height)), weapon_traitconf_item_width, 25);
        }

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.font = "15px monospace";
        rebound_helpers.draw_text_colored(this, ctx, [
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
              color: "THEME_IMPORTANT",
              text: "▉"
            } : {
              color: "gray",
              text: "▉"
            }
          }).concat([{
            color: "THEME_IMPORTANT",
            text: " " + this.player.weapons[this.selected_weapon_index].conf[configurable.key] + " / " + configurable.maxval
          }])
        ], weapon_traitconf_x_pos + 10, y_coord + 10, "monospace 15px", 20, true);
        ctx.restore();
      });

      ctx.restore();


      // @TODO put in update
      if (this.mousedown && this.gun_anim_back < 5) {
        this.player_action_ack_id = Date.now() + Math.random();

        if (this.player.weapons[this.selected_weapon_index].ammo > 0) {
          socket.emit("gun", {
            dir: Math.atan2(this.gun_dir.getX(), this.gun_dir.getY()),
            selected_weapon: this.selected_weapon_index,
            action_ack_id: this.player_action_ack_id
          });
          this.gun_anim_back = 15 + (this.player.weapons[this.selected_weapon_index].conf.additional_callibur * 5);
          rebound_common.apply_gun_forces(this.player, this.get_gun_dir_vec(), this.player.weapons[this.selected_weapon_index]);
        }
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

    get_gun_dir_vec() {
      return this.gun_dir;
    }

    get_gun_dir_deg() {
      return this.get_gun_dir_vec().getdeg();
    }

    refresh_leaderboard() {
      fetch("/leaderboard", {
        method: "GET",
        cache: "no-cache"
      }).then((response) => {
        response.json().then((json) => {
          this.leaderboard_json = json;
        });
      });
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