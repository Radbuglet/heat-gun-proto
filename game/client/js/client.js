(function() {
  const socket = io();
  
  // LAG SWITCH!
  (function() {
    var oldEmit = socket.emit;
    socket.emit = function() {
      var args = Array.from(arguments);
      setTimeout(() => {
        oldEmit.apply(this, args);
      }, Math.floor(Math.random() * 0) + 0);
    };
  })();

  const flashblind_filter = "blur(30px) brightness(120%) grayscale(100%)";

  class Game extends rebound_helpers.CanvasApplication {
    // Application code
    init() {
      console.log("This project is open sourced. If you want to see the source code, head over to https://github.com/Radbuglet/heat-gun-proto");

      this.last_ping = "...";
      this.ping_avg_sum = 0;
      this.ping_avg_counter = 0;

      this.visfov = 180;
      this.latest_heartbeat_packet = 0;
      this.last_heartbeat_time = Date.now();
      this.action_unk_count = 0;
      this.gun_dir = new rebound_common.Vector(0, 1);
      this.gun_anim_back = 0;
      this.death_reason = [];
      this.state = "menu";
      this.player_action_ack_id = null;
      this.power_up_crystal_data = [];
      this.cloud_horizon = new rebound_helpers.CloudHorizon(this.ctx);
      this.draw_3d = window.localStorage.opt_use_3d == "1";
      this.impact_particles = [];

      this.player = null;
      this.other_players = {};
      this.camera = new rebound_helpers.Camera(new rebound_common.Vector(0, 0));
      this.last_selected_weapon = 1;
      this.selected_trait_edit_index = 0;

      this.leaderboard_json = null;
      this.leaderboard_index = 0;
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

      setInterval(() => {
        socket.emit("svping", Date.now());
      }, 500);

      socket.on("svpong", clts => {
        this.ping_avg_sum += Math.floor(Date.now() - clts);
        this.ping_avg_counter++;
        
        if (this.ping_avg_counter >= 5) {
          this.last_ping = Math.floor(this.ping_avg_sum / this.ping_avg_counter);
          this.ping_avg_counter = 0;
          this.ping_avg_sum = 0;
        }
      });

      socket.on('new_message', msg => {
        this.add_message(msg);
      });

      socket.on('add_beams', beams_list => {
        beams_list.forEach(beam_pkt => {
          let beam = {
            path: beam_pkt.beam_path,
            size: beam_pkt.beam_size,
            lingering_trail: beam_pkt.lingering_trail,
            color: beam_pkt.color,
            exist_until: Date.now() + 1000
          }

          this.beams.push(beam);

          this.impact_particles.push({
            from_you: beam_pkt.instigator === this.my_pub_uuid,
            pos: beam_pkt.beam_path[beam_pkt.beam_path.length - 1],
            size: new rebound_common.LerpNum((beam_pkt.lingering_trail) * 70, 0, (beam_pkt.lingering_trail + 1) * 800, (beam_pkt.lingering_trail + 1) * 1250)
          });
        });
      });

      socket.on('heartbeat-slim', data => {
        if (data.svr_timestamp < this.latest_heartbeat_packet) {
          console.warn("Ignoring latent packet!");
        }

        this.latest_heartbeat_packet = data.svr_timestamp;

        const players_data = data.players;

        for (const user_id in players_data) {
          const pos_data = players_data[user_id];

          if (user_id === this.my_pub_uuid && pos_data[5]) {
            continue
          }

          const player = user_id === this.my_pub_uuid ? this.player : this.other_players[user_id];

          if (player) {
            player.position.setX(pos_data[0]);
            player.position.setY(pos_data[1]);
            player.velocity.setX(pos_data[2]);
            player.velocity.setY(pos_data[3]);
            player.lowered_phys = pos_data[4];
          }
        }
      });

      socket.on('heartbeat', data => {
        console.log("Heartbeat recieved");
        if (data.svr_timestamp < this.latest_heartbeat_packet) {
          console.warn("Ignoring latent packet!");
        }
        this.latest_heartbeat_packet = data.svr_timestamp;
        this.last_heartbeat_time = Date.now();

        rebound_common.disable_collision_indices = data.disable_collision_indices;

        this.my_pub_uuid = data.my_pub_uuid

        if (data.power_up_crystal_data instanceof Array) {
          this.power_up_crystal_data = data.power_up_crystal_data;
        }

        let number_of_yous = 0;

        data.player_data.forEach(player_data => {
          let player = null,
            update_position = typeof data.glob_add !== typeof {} || typeof data.glob_add.onlyupdatepos !== typeof [] || data.glob_add.onlyupdatepos.indexOf(player_data.pub_uuid) !== -1;

          if (player_data.pub_uuid === data.my_pub_uuid) {
            player = this.player;

            if (this.player_action_ack_id !== null && this.player_action_ack_id !== player_data.action_ack_id && this.action_unk_count < 2) {
              console.warn("Refusing to update own player, heartbeat doesn't acknowledge action. HB ACK ID =", player_data.action_ack_id, " CLI ACK ID =", this.player_action_ack_id);
              this.action_unk_count += 1;
              return;
            }

            if (this.player_action_ack_id !== null) {
              update_position = false;
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
            if (update_position) {
              player.position.setX(player_data.pX);
              player.position.setY(player_data.pY);

              player.velocity.setX(player_data.vX);
              player.velocity.setY(player_data.vY);
            }

            player.health = player_data.health;
            player.energy = player_data.energy;
            player.total_energy = player_data.total_energy;

            player.weapons = player_data.weapons.map((weapon, i) => {
              weapon.cli_internal = player.weapons[i].cli_internal;
              return weapon;
            });
            player.selected_slot = player_data.selected_slot
            player.lowered_phys = player_data.lowered_phys;
            player.death_reason = player_data.death_reason;
            player.power_up_slot = player_data.power_up_slot;
            player.current_power_up = player_data.current_power_up;
            player.power_up_time_left = player_data.power_up_time_left;
            player.can_use_rush = player_data.can_rush;

            // Temporarily disabled due to buggy timestamps
            /*for (let x = 0; x < sv_ticks; x++) {
              rebound_common.apply_physics(player, 1);
            }*/
          }
        });

        for (let pub_uuid in this.other_players) {
          if (data.player_data.filter(d => d.pub_uuid === pub_uuid).length === 0) {
            delete this.other_players[pub_uuid];
          }
        }
      });
    }

    add_message(msg) {
      this.chat_messages.push(msg);
      this.chat_messages.reverse();
      this.chat_messages = this.chat_messages.slice(0, 10);
      this.chat_messages.reverse();
    }

    update(dt, ticks) {
      if (this.state === "game") {
        if (this.player !== null) {
          if (this.player.current_power_up == "infinite_dashes") {
            this.player.can_use_rush = true;
          }
          if (rebound_common.is_on_ground(this.player)) {
            this.player.can_use_rush = true;
          }
        }
        if (this.player == null || this.player.health <= 0) {
          this.state = "menu";

          this.death_reason = this.player !== null ? this.player.death_reason : [];

          this.refresh_leaderboard();
        } else {
          rebound_common.apply_physics(this.player, ticks);
          console.log(this.player.velocity.getX(), this.player.velocity.getY());

          for (let key in this.other_players) {
            let plr = this.other_players[key];
            rebound_common.apply_physics(plr, ticks, plr.selected_slot);
          }

          this.camera.lookvec.setX(this.player.client_interp_position.getX() + (this.player.lowered_phys ? rebound_common.get_teleportation_vec(this.get_gun_dir_vec(), this.player.get_active_weapon().conf.teleportation).getX() : 0), 50);
          this.camera.lookvec.setY(this.player.client_interp_position.getY() + (this.player.lowered_phys ? rebound_common.get_teleportation_vec(this.get_gun_dir_vec(), this.player.get_active_weapon().conf.teleportation).getY() : 0), 50);

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

      if (e.code === "KeyR" && !e.shiftKey) {
        this.draw_3d = !this.draw_3d;
        window.localStorage.opt_use_3d = this.draw_3d ? "1" : "0";
      }

      if (this.player !== null) {
        let nums = [
          "1", "2", "3", "4", "5", "6", "7", "8", "9"
        ].forEach((key_id, index) => {
          if (index < this.player.weapons.length) {
            if (e.key === key_id) {
              this.select_slot(index);
            }
          }
        });

        if (e.code === "Space") {
          socket.emit('set_lowered_phys', true, {
            x: this.player.position.getX(),
            y: this.player.position.getY()
          });
          this.player.lowered_phys = true;
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
            weapon: this.player.selected_slot,
            trait: this.selected_trait_edit_index,
            is_increase: false
          });
        }

        if (e.key === "ArrowRight") {
          socket.emit("trait_change", {
            weapon: this.player.selected_slot,
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

        if (rush_pkt_dir !== null && this.player.can_use_rush) {
          this.player_action_ack_id = Math.random();

          const dir_vec = rebound_common.rush_packet_enum_dirs[rush_pkt_dir];

          if (!rebound_common.is_on_ground(this.player)) {
            this.player.can_use_rush = false;
          }

          if (dir_vec.getX() !== 0) {
            this.player.velocity.setX(dir_vec.getX() * 20);
          }

          if (dir_vec.getY() !== 0) {
            this.player.velocity.setY(dir_vec.getY() * 20);
          }

          socket.emit('rush', rush_pkt_dir, this.player_action_ack_id);
        }
      }
    }

    app_keyup(e) {
      if (this.player !== null) {
        if (e.keyCode === 32 || e.keyCode === 16) {
          socket.emit('set_lowered_phys', false, {
            x: this.player.position.getX(),
            y: this.player.position.getY()
          });
          this.player.lowered_phys = false;
        }
      }
    }

    render(ctx, w, h, update_ticks) {
      ctx.clearRect(0, 0, w, h);

      function rdiff() {
        return Math.floor(Math.random() * 100) - 50;
      }

      if (this.state !== "game") {
        if (this.state === "menu") {
          this.cloud_horizon.draw(this.getHeight());

          this.camera.zoom = 0.7;
          this.camera.lookvec = new rebound_common.Vector(Math.sin(Date.now() / 3000) * 4000 + 1400, Math.sin(Date.now() / 1000) * 1000);

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
                "color": "lime",
                "text": "<-",
                "click_action": () => {
                  this.leaderboard_index--;
                  if (this.leaderboard_index < 0) {
                    this.leaderboard_index = this.leaderboard_json.length - 1;
                  }
                },
                "click_underline": "lime"
              },
              {
                "color": "lime",
                "text": this.leaderboard_json ? (" " + this.leaderboard_json[this.leaderboard_index].name + ((" ").repeat(10 - this.leaderboard_json[this.leaderboard_index].name.length))) : " ... "
              },
              {
                "color": "lime",
                "text": "->",
                "click_action": () => {
                  this.leaderboard_index++;
                  if (this.leaderboard_index >= this.leaderboard_json.length) {
                    this.leaderboard_index = 0;
                  }
                },
                "click_underline": "lime"
              },
              {
                "color": "",
                "text": " "
              },
              {
                "color": "yellow",
                "text": "Refresh",
                "click_action": () => {
                  this.refresh_leaderboard();
                },
                "click_underline": "gold"
              }
            ],
            []
          ]);

          if (this.leaderboard_json !== null) {
            const current_leaderboard = this.leaderboard_json[this.leaderboard_index].scores;

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
      //this.cloud_horizon.draw(this.getHeight());

      let is_in_flash = false;
      let current_flash = null;

      this.impact_particles.forEach((p) => {
        if (new rebound_common.Vector(p.pos.pX, p.pos.pY).distance(this.player.position) < p.size.getCurrentVal() && !p.from_you) {
          is_in_flash = true;
          current_flash = p;
        }
      });

      // Scene rendering

      this.camera.zoom = ((this.camera.zoom + (1 - this.player.get_active_weapon().conf.scope * 0.08)) / 2) // + (is_in_flash ? 0.8 : 0);
      this.camera.attach(ctx, w, h);

      ctx.save();
      /*ctx.beginPath();

      const plcenter = this.player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2)).sub(this.get_gun_dir_vec().mult(new rebound_common.Vector(100, 100)))
      ctx.moveTo(plcenter.getX(), plcenter.getY());
      const vislimit_m = this.get_gun_dir_rad();
      const vislimit_fov = rebound_common.torad(this.visfov);

      this.visfov = (this.visfov + ((!this.player.lowered_phys || this.player.get_active_weapon().conf.additional_callibur === 0) ? 180 : (
        140 - this.player.get_active_weapon().conf.additional_callibur * 15
      ))) / 2;
      ctx.lineTo(
        plcenter.getX() + Math.sin(vislimit_m - vislimit_fov) * 1000000,
        plcenter.getY() + Math.cos(vislimit_m - vislimit_fov) * 1000000
      );

      ctx.lineTo(
        plcenter.getX() + Math.sin(vislimit_m) * 1000000,
        plcenter.getY() + Math.cos(vislimit_m) * 1000000
      );

      ctx.lineTo(
        plcenter.getX() + Math.sin(vislimit_m + vislimit_fov) * 1000000,
        plcenter.getY() + Math.cos(vislimit_m + vislimit_fov) * 1000000
      );
      
      if (this.visfov < 175) {
        ctx.clip();
      }*/

      // Render world
      let del_list = []
      let temp_beams = [];
      this.beams.forEach((beam, i) => {
        ctx.save();
        ctx.strokeStyle = beam.color;
        ctx.lineWidth = beam.size * 2;
        if (!(beam.path[0] instanceof rebound_common.Vector) && beam.path[1] !== undefined) {
          beam.path[0] = new rebound_common.Vector(beam.path[0].pX, beam.path[0].pY);

          const bdst = (beam.path[0].distance(new rebound_common.Vector(beam.path[1].pX, beam.path[1].pY)) * 0.2) * (beam.lingering_trail + 1);
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

      rebound_helpers.draw_player(ctx, this.player, true);

      if (this.player.lowered_phys) {
        rebound_helpers.draw_player(ctx, this.player, false, this.player.client_interp_position.add(
          rebound_common.get_teleportation_vec(this.get_gun_dir_vec(), this.player.get_active_weapon().conf.teleportation)
        ));
      }

      let player_visgroup, player_toucheddec;

      rebound_common.world.tiles.forEach((tile, i) => {
        if (tile.layer === "dec" && rebound_common.testrectcollision(this.player.position.getX(), this.player.position.getY(), rebound_common.conf.player_size, rebound_common.conf.player_size, tile.x, tile.y, tile.w, tile.h)) {
          player_visgroup = tile.visgroup;
          player_toucheddec = i;
        }
      });

      rebound_helpers.draw_crystals(ctx, this.power_up_crystal_data, this.total_frames);

      for (let player_pub_uuid in this.other_players) {
        const player = this.other_players[player_pub_uuid];
        rebound_helpers.draw_player(ctx, player, true);

        /*if (Math.abs(this.get_gun_dir_vec() - this.player.position.sub(player.position).getdeg()) < 3) {
          ctx.save();
          ctx.fillStyle = "red";
          ctx.fillRect(player.position.getX(), player.position.getY(), 10, 10)
          ctx.restore();
        }*/
        /*const is_on_ground = rebound_common.is_on_ground(player.position);
        rebound_helpers.draw_gun(ctx, player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2)),
          ((!is_on_ground) ? player.velocity.normalized() :
            new rebound_common.Vector(Math.sin(rebound_common.torad(this.total_frames)), Math.cos(rebound_common.torad(this.total_frames)))
          )
          .mult(new rebound_common.Vector(30, 30)), is_on_ground);*/
      }

      rebound_helpers.draw_world(ctx, w, h, this.camera, undefined, undefined, this.draw_3d, player_visgroup, player_toucheddec);


      this.impact_particles = this.impact_particles.filter((p) => {
        return p.size.getCurrentVal() > 0
      });

      this.impact_particles.forEach((p) => {
        ctx.save();
        ctx.beginPath();
        ctx.fillStyle = "#fff";
        if (p.from_you) {
          ctx.globalAlpha = 0.9;
        } else {
          ctx.globalAlpha = 0.98;
        }
        ctx.arc(p.pos.pX, p.pos.pY, p.size.getCurrentVal(), 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      })

      const gun_pos = this.player.position.add(new rebound_common.Vector(rebound_common.conf.player_size / 2, rebound_common.conf.player_size / 2));

      if (this.player.lowered_phys) {
        ctx.save();
        ctx.strokeStyle = "green";
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 5;
        ctx.beginPath();

        let weapon = this.player.get_active_weapon();
        let ray = new rebound_common.Ray();
        ray.chkstep = 3;
        ray.starting_pos = gun_pos.add(
          rebound_common.get_teleportation_vec(this.get_gun_dir_vec(), weapon.conf.teleportation)
        ).clone().div(new rebound_common.Vector(ray.chkstep, ray.chkstep)).floor().mult(new rebound_common.Vector(ray.chkstep, ray.chkstep));
        ray.max_dist = 2000;
        ray.max_dist = Math.max(1000 + (weapon.conf.additional_callibur * 200) - (weapon.conf.additional_barrels * 75), 100) + (weapon.conf.bullet_gravity * 200);
        ray.direction = this.get_gun_dir_vec().clone();
        ray.size = 5 + weapon.conf.additional_size * 3;
        ctx.lineWidth = ray.size * 2;

        ray.gravity = Math.max((weapon.conf.bullet_gravity * 0.5 - (weapon.conf.additional_callibur * 0.1)), 0);

        ctx.moveTo(ray.starting_pos.getX(), ray.starting_pos.getY());

        ray.extra_check = () => {
          ctx.lineTo(ray.pos.getX(), ray.pos.getY());

          for (const key in this.other_players) {
            const oplayer = this.other_players[key];


            if (rebound_common.testrectcollision(ray.pos.getX() - 2, ray.pos.getY() - 2, 4, 4, oplayer.position.getX(), oplayer.position.getY(), rebound_common.conf.player_size, rebound_common.conf.player_size)) {
              ctx.strokeStyle = "red";
              return false;
            }
          }

          return true;
        }

        ray.trace();

        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ray.pos.getX(), ray.pos.getY(), weapon.conf.lingering_trails * 70, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.restore();
      }

      rebound_helpers.draw_gun(ctx, gun_pos, this.get_gun_dir_vec().mult(new rebound_common.Vector(30, 30)));


      rebound_helpers.draw_kill_line(ctx, this.camera, new rebound_common.Vector(w, h), rebound_common.conf.tpzone_bottom);
      rebound_helpers.draw_kill_line(ctx, this.camera, new rebound_common.Vector(w, h), rebound_common.conf.tpzone_top);

      ctx.restore();
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

      for (let hpl = 0; hpl < 25; hpl++) {
        const wid = (bar_w / 25);
        const pos = bar_x + hpl * wid;

        // @TODO you can use `hsl()` color function instead of this crazy thing!
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
      ctx.fillText(this.player.get_active_weapon().ammo + "⁌", ammo_px + (100 / 2), ammo_py + (50 / 2));
      ctx.restore();



      ctx.save();
      rebound_helpers.draw_text_colored(this, ctx, this.chat_messages, 10, h - 100 - (this.chat_messages.length * 17), "15px monospace", 17, true);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "#3f51b5";
      ctx.font = "15px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";

      function generate_ctext_indicator(name, value, additional_bspaces, override_text_color) {
        const expected_length = 13;
        const text_length = (" " + name + ": " + new Array(additional_bspaces || 0).fill(" ").join("") + value + " ").length - 1;

        return [{
            "color": "#FF5555",
            "bg": "#3f3d3fdd",
            "text": " " + name + ": " + new Array(additional_bspaces || 0).fill(" ").join("")
          },
          {
            "color": override_text_color || "THEME_IMPORTANT",
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
        generate_ctext_indicator("FPS", this.fps).concat(generate_ctext_indicator("PING", this.last_ping, 2, typeof this.last_ping === typeof 1 ? (
          this.last_ping < 50 ? "lime" :
          (
            this.last_ping < 125 ? "green" :
            (
              this.last_ping < 250 ? "yellow" : "red"
            )
          )
          
        ) : "gray")),
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
      ), 10, 0, "17px monospace", 19, true);

      ctx.restore();

      ctx.save();

      // Weapons list
      ctx.save();
      const weapon_item_width = 250;
      const weapon_item_height = 50;
      const weapon_item_in_between = 20;
      const weapon_ui_padding = 50;

      const weapons_x_start = w / 2 - ((this.player.weapons.length * (weapon_item_width + weapon_item_in_between)) - weapon_ui_padding) / 2;
      const weapon_y_pos = h - 200;

      this.player.weapons.forEach((weapon, index) => {
        ctx.save();
        ctx.fillStyle = this.player.selected_slot === index ? `hsl(${Date.now() / 20}deg, 30%, 50%)` : `#3f3d3fdd`;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        let is_usable = weapon.ammo > 0 && weapon.cli_internal.back_anim <= 0;
        const weapon_x_coord = weapons_x_start + (weapon_item_width + weapon_item_in_between) * index;

        if (!is_usable) {
          ctx.fillStyle = this.player.selected_slot === index ? "#f72e13" : "#872215";
        }
        ctx.strokeRect(weapon_x_coord, weapon_y_pos, weapon_item_width, weapon_item_height);
        ctx.fillRect(weapon_x_coord, weapon_y_pos, weapon_item_width, weapon_item_height);

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = "15px monospace";
        ctx.fillStyle = "#fff";
        if (is_usable) {
          ctx.font = "bold 15px monospace";
        }
        ctx.fillText(
          index + 1 + " [" + weapon.ammo + "] " + new Array(Math.max(Math.floor(weapon.cli_internal.back_anim / 4), 0)).fill("*").join(""),
          weapon_x_coord + 15, weapon_y_pos + weapon_item_height / 2);
        ctx.restore();
      });



      const traits_visible = 3;
      const weapon_traitconf_item_width = 250;
      const weapon_traitconf_item_height = 80;
      const weapon_traitconf_item_in_between = 20;
      const weapon_traitconf_padding = 50;
      const weapon_traitconf_x_pos = w - weapon_traitconf_item_width - weapon_traitconf_padding;

      const weapons_traitconf_start = h - (traits_visible * (weapon_traitconf_item_height + weapon_traitconf_item_in_between)) - weapon_traitconf_padding;

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

        if (Math.abs(index - this.selected_trait_edit_index) > 2) return;

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

        ctx.strokeStyle = this.player.energy >= configurable.cost ? "#fff" : "red";
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
            return i < this.player.get_active_weapon().conf[configurable.key] ? {
              color: "THEME_IMPORTANT",
              text: "▉"
            } : {
              color: "gray",
              text: "▉"
            }
          }).concat([{
            color: "THEME_IMPORTANT",
            text: " " + this.player.get_active_weapon().conf[configurable.key] + " / " + configurable.maxval
          }])
        ], weapon_traitconf_x_pos + 10, y_coord + 10, "monospace 15px", 20, true);
        ctx.restore();
      });

      ctx.restore();


      // @TODO put in update
      if (this.mousedown && this.player.get_active_weapon().cli_internal.back_anim === 0) {
        this.player_action_ack_id = Date.now() + Math.random();

        if (this.player.get_active_weapon().ammo > 0) {
          if (rebound_common.canMoveInDir(this.player.position, rebound_common.get_teleportation_vec(this.get_gun_dir_vec(), this.player.get_active_weapon().conf.teleportation))) {
            socket.emit("gun", {
              dir: Math.atan2(this.gun_dir.getX(), this.gun_dir.getY()),
              selected_weapon: this.player.selected_slot,
              action_ack_id: this.player_action_ack_id,
              player_x: this.player.position.getX(),
              player_y: this.player.position.getY()
            });

            let beam = {
              path: [{
                  pX: this.player.position.getX() + rebound_common.conf.player_size / 2,
                  pY: this.player.position.getY() + rebound_common.conf.player_size / 2
                },
                {
                  pX: this.player.position.getX() + rebound_common.conf.player_size / 2 + this.get_gun_dir_vec().getX() * 500,
                  pY: this.player.position.getY() + rebound_common.conf.player_size / 2 + this.get_gun_dir_vec().getY() * 500
                }
              ],
              size: 5,
              lingering_trail: 10,
              color: `green`,
              exist_until: Date.now() + 1000
            }

            //this.beams.push(beam);

            this.player.get_active_weapon().ammo--;
            this.player.get_active_weapon().cli_internal.back_anim = (
              (
                15 +
                (this.player.get_active_weapon().conf.additional_callibur * 12) +
                (this.player.get_active_weapon().conf.additional_barrels * 5) +
                (this.player.get_active_weapon().conf.additional_launching_power * 1)
              ) * rebound_common.get_firerate_multiplier(this.player.get_active_weapon().conf.fire_rate) +
              (
                (this.player.get_active_weapon().conf.lingering_trails * 15) +
                (this.player.get_active_weapon().conf.teleportation * 4)
              )
            )

            rebound_common.apply_gun_forces(this.player, this.get_gun_dir_vec(), this.player.get_active_weapon(), this);
          }
        }
      }

      this.player.weapons.forEach(weapon => {
        if (weapon.cli_internal.back_anim > 0) weapon.cli_internal.back_anim -= 1;
        weapon.cli_internal.back_anim = Math.max(weapon.cli_internal.back_anim, 0);
      });

      ctx.restore();

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

      if (Date.now() - this.last_heartbeat_time > 3000) {
        ctx.save();

        ctx.fillStyle = `hsl(${Date.now() / 20}deg, 50%, 50%)`;
        ctx.fillRect(0, 0, 400, 135);
        ctx.fillStyle = "white";

        ctx.font = "20px monospace";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";

        ctx.fillText("Server not responding", 200, 67.5);


        ctx.restore();
      }

      if (is_in_flash) {
        if (!this.has_flashblind_filter()) {
          this.canvas.style.filter = flashblind_filter;
          this.canvas.style.transition = "filter 1s";
        }
      } else {
        if (this.has_flashblind_filter()) {
          this.canvas.style.filter = "none";
          this.canvas.style.transition = "filter 4s";
        }
      }
    }

    get_gun_dir_vec() {
      return this.gun_dir;
    }

    get_gun_dir_deg() {
      return this.get_gun_dir_vec().getdeg();
    }

    get_gun_dir_rad() {
      return this.get_gun_dir_vec().getrad();
    }

    has_flashblind_filter() {
      return this.canvas.style.filter == flashblind_filter;
    }

    app_mousedown(e) {
      if (e.button === 2) {
        this.select_slot(this.last_selected_weapon);
      }
    }

    select_slot(slot) {
      this.last_selected_weapon = this.player.selected_slot;
      this.player.selected_slot = slot;
      socket.emit('slot_change', this.player.selected_slot);
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
}());