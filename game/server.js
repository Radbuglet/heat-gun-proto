const express = require('express');
const socketio = require('socket.io');
const uuid4 = require('uuid/v4');

const http = require('http');
const path = require('path');
const fs = require('fs');

const common = require('./common/common');

const app = express();

const conf_path = path.join(__dirname, "config.json");
const leaderboard_path = path.join(__dirname, "leaderboard.json");
let config_data;
let leaderboard_data;

if (fs.existsSync(conf_path) && fs.statSync(conf_path).isFile()) {
  config_data = JSON.parse(
    fs.readFileSync(conf_path, "utf-8"));
} else {
  throw "Missile config.json in the same directory as server.js";
}

if (fs.existsSync(leaderboard_path) && fs.statSync(leaderboard_path).isFile()) {
  leaderboard_data = JSON.parse(
    fs.readFileSync(leaderboard_path, "utf-8"));
} else {
  throw "Missile leaderboard.json in the same directory as server.js";
}

config_data.map_data.tiles = JSON.parse(fs.readFileSync(path.join(__dirname, "map_tiles.json"), "utf-8"));

common.apply_config(config_data);

app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, "client/game.html"));
});

app.get('/editor', function(req, res) {
  res.sendFile(path.join(__dirname, "client/editor.html"));
});

app.get('/config', function(req, res) {
  res.type("text/javascript").send("window.rebound_config = " + JSON.stringify(config_data));
});

app.get('/leaderboard', function(req, res) {
  res.send(leaderboard_data);
});

app.use('/common', express.static(path.join(__dirname, "common")));
app.use('/js', express.static(path.join(__dirname, "client/js")));

app.use((req, res) => {
  res.redirect('/');
});

const server = http.createServer(app);
const socket = socketio(server);

let players = {}; // Hashmap<SocketUID, SocketUserController>
const power_up_crystal_data = common.world.power_up_boxes.map(_ => {
  return {
    "health": 5,
    "recharge_time": 30
  }
});

class SocketUserController {
  constructor(client) {
    this.player = null;
    this.pub_uuid = uuid4();
    this.client = client;
    this.last_fuel_ammo_time = 0;
  }

  play(username) { // (Username pre validated)
    this.player = new common.Player(username);
  }

  sendMessage(line) {
    this.client.emit("new_message", line);
  }

  dead() {
    leaderboard_data.forEach(category => {
      if (category.scores.length >= category.max_entries) {
        if (this.player.total_energy <= category.scores[category.scores.length - 1].score) {
          return;
        } else {
          category.scores.pop();
        }
      }

      let add_index = category.scores.length - 1;
      for (let i_index = 0; i_index < category.scores.length; i_index += 1) {
        if (category.scores[i_index].score < this.player.total_energy) {
          add_index = i_index;
          break;
        }
      }

      category.scores.splice(add_index, 0, {
        name: this.player.name,
        added: Date.now(),
        score: Math.round(this.player.total_energy),
      });
    });

    this.player = null;
  }

  isPlaying() {
    return this.player !== null;
  }

  damage_player(ammount, death_message) {
    this.player.health -= ammount;

    if (this.player.health <= 0) {
      this.player.death_reason = death_message || [];
      broadcast_state(this);
      this.dead();
      broadcast_state();
    }
  }
}

socket.on('connection', client => {
  console.log("A client has connected!");

  /*(function() {
    var oldEmit = client.emit;
    client.emit = function() {
      var args = Array.from(arguments);
      setTimeout(() => {
        oldEmit.apply(this, args);
      }, 0);
    };
  })();*/

  let user = new SocketUserController(client);
  players[client.id] = user;

  client.on('play', username => {
    if (typeof username === "string" && common.is_valid_username(username) === null && !user.isPlaying()) {
      user.play(username);
      console.log("A socket is playing with name " + username);

      let spawn_loc;
      while (true) {
        spawn_loc = new common.Vector(Math.floor(Math.random() * 5000) - 1000, Math.floor(Math.random() * 2000 - 2500));

        if (!common.canMoveInDir(spawn_loc, new common.Vector(0, 0))) {
          continue;
        }

        let is_ok = true;
        while (common.canMoveInDir(spawn_loc, new common.Vector(0, 1))) {
          spawn_loc.setY(spawn_loc.getY() + 1);
          if (spawn_loc.getY() > common.conf.min_kill_y) {
            is_ok = false;
            break;
          }
        }

        if (is_ok) {
          break;
        }
      }
      user.player.position = spawn_loc;

      broadcast_state(null, undefined, {
        onlyupdatepos: [user.pub_uuid]
      });

      broadcast_message([{
          color: "#ee1a1a",
          text: username
        },
        {
          color: "gray",
          text: " joined the area"
        }
      ]);
      client.emit("resp_play", {
        username,
        pub_uuid: user.pub_uuid,
        spawnX: spawn_loc.getX(),
        spawnY: spawn_loc.getY()
      });
    } else {
      console.log("A socket is playing with name " + username + " (INVALID)");
    }
  });

  client.on("svping", clts => {
    if (typeof clts === typeof 1) {
      socket.emit("svpong", clts);
    }
  });

  client.on("gun", data => {
    if (typeof data !== typeof {}) return
    const dir = data.dir;
    if (typeof dir !== typeof 1) {
      return;
    }

    if (user.isPlaying()) {
      if (typeof data.selected_weapon !== typeof 1 || data.selected_weapon > user.player.weapons.length) {
        return;
      }

      if (data.selected_weapon !== user.player.selected_slot) {
        user.player.selected_slot = data.selected_weapon;
      }

      const ray_list = [];
      const weapon = user.player.weapons[data.selected_weapon];
      if (weapon.ammo <= 0) return;
      const hit_users = [];
      weapon.ammo--;

      common.apply_gun_forces(user.player, new common.Vector(Math.sin(dir), Math.cos(dir)), weapon);

      for (let bc_itt = 0; bc_itt < (weapon.conf.additional_barrels + 1); bc_itt++) {

        const dir_rad_innac = (Math.random() - 0.75) * ((weapon.conf.additional_barrels + weapon.conf.additional_size * 0.025) / 5);
        const vec = new common.Vector(Math.sin(dir + dir_rad_innac), Math.cos(dir + dir_rad_innac));

        if (!common.canMoveInDir(user.player.position, common.get_teleportation_vec(vec, weapon.conf.teleportation))) {
          return;
        }


        let ray = new common.Ray();
        ray.starting_pos = user.player.position.clone().add(new common.Vector(common.conf.player_size / 2, common.conf.player_size / 2)).add(vec.mult(new common.Vector(3, 3)));
        ray.max_dist = Math.max(1000 + (weapon.conf.additional_callibur * 200) - (weapon.conf.additional_barrels * 75), 100) + (weapon.conf.bullet_gravity * 200);
        ray.direction = vec;
        ray.size = 5 + weapon.conf.additional_size * 3;

        ray.gravity = Math.max((weapon.conf.bullet_gravity * 0.5 - (weapon.conf.additional_callibur * 0.1)), 0);

        ray.extra_check = function() {
          let return_val = true;
          for (let sock_uuid in players) {
            let ouser = players[sock_uuid];
            if (ouser !== null && ouser.isPlaying() && ouser.pub_uuid !== user.pub_uuid) {
              if (common.testrectcollision(
                  ray.pos.getX() - ray.get_size_vec().getX() / 2, ray.pos.getY() - ray.get_size_vec().getY() / 2, ray.get_size_vec().getX(), ray.get_size_vec().getY(),
                  ouser.player.position.getX(), ouser.player.position.getY(),
                  common.conf.player_size, common.conf.player_size
                )) {
                let damage = Math.max(4 + (weapon.conf.additional_callibur * 1.5) + (weapon.conf.additional_barrels * 7), 3) / (weapon.conf.additional_barrels + 1) * common.get_firerate_multiplier(weapon.conf.fire_rate);
                if (ouser.player.health - damage <= 0) {
                  broadcast_message([{
                      color: "darkred",
                      text: ouser.player.name
                    },
                    {
                      color: "#ee1a1a",
                      text: " was killed by " + user.player.name
                    }
                  ]);
                }

                let gained_energy = damage / 4;

                ouser.sendMessage([{
                    color: "red",
                    text: user.player.name
                  }, {
                    color: "darkred",
                    text: " did "
                  },
                  {
                    color: "red",
                    text: Math.floor(damage * 10) / 10
                  },
                  {
                    color: "darkred",
                    text: " damage to you!"
                  }
                ]);

                user.player.energy += gained_energy;
                user.player.total_energy += gained_energy;
                user.sendMessage([{
                    color: "darkgreen",
                    text: "You gained "
                  },
                  {
                    color: "green",
                    text: Math.floor(gained_energy * 10) / 10
                  },
                  {
                    color: "darkgreen",
                    text: " energy!"
                  },
                  {
                    color: "red",
                    text: " Damage dealt: " + Math.floor(damage * 10) / 10
                  }
                ]);

                ouser.player.velocity = new common.Vector(0, weapon.conf.lingering_trails > 0 ? -2 : -20).add(ray.direction.mult(new common.Vector(weapon.conf.lingering_trails > 0 ? 5 : 25, weapon.conf.lingering_trails > 0 ? 5 : 25))
                  .mult(new common.Vector(common.get_firerate_multiplier(weapon.conf.fire_rate), common.get_firerate_multiplier(weapon.conf.fire_rate))));
                hit_users.push(ouser.pub_uuid);
                ouser.damage_player(damage, [
                  [{
                      color: "darkgray",
                      text: "You were killed by "
                    },
                    {
                      color: "red",
                      text: user.player.name
                    }
                  ]
                ]);
                return_val = false;
              }
            }
          }

          common.world.power_up_boxes.forEach((box_pos, i) => {
            const box_data = power_up_crystal_data[i];

            if (box_data.health > 0) {
              if (ray.pos.distance(new common.Vector(box_pos.x, box_pos.y)) < 100) {
                box_data.health--;
                return_val = false;
              }
            }
          })
          return return_val;
        }
        ray.world_collidable = user.player.current_power_up !== "faze_bullet";

        ray.trace();

        if (ray.last_collided_object !== null && ray.last_collided_object.toggleable && user.player.lowered_phys) {
          // @TODO test player collisions
          let can_do_it = true;
          for (let sock_uuid in players) {
            let ouser = players[sock_uuid];
            if (ouser !== null && ouser.isPlaying()) {
              if (common.testrectcollision(ouser.player.position.getX(), ouser.player.position.getY(), common.conf.player_size, common.conf.player_size, ray.last_collided_object.x, ray.last_collided_object.y, ray.last_collided_object.w, ray.last_collided_object.h)) {
                can_do_it = false;
                break;
              }

            }
          }

          if (can_do_it) {
            common.disable_collision_indices[ray.last_collided_object.collision_world_index] = common.disable_collision_indices[ray.last_collided_object.collision_world_index] !== true ? true : false;
          }
        }
        ray_list.push(ray);
      }

      socket.emit("add_beams", ray_list.map((ray) => {
        return {
          instigator: user.pub_uuid,
          beam_path: ray.path.map(p => {
            return {
              pX: p.getX(),
              pY: p.getY()
            }
          }),
          beam_size: ray.size,
          color: `hsl(${(weapon.conf.trail_color / 10) * 360}, 90%, 50%)`,
          lingering_trail: weapon.conf.lingering_trails + (user.player.current_power_up === "flashy_bullets" ? 4 : 0)
        }
      }));

      user.player.action_ack_id = data.action_ack_id;
      // If you're wondering what will happen to the players that get damaged, they still will be damaged
      // because my netcode is bad and damage to players will broadcast anyway.
      broadcast_state_positions();
    }
  });

  client.on("slot_change", i => {
    if (user.isPlaying()) {
      if (typeof i !== typeof 1 || i > user.player.weapons.length) {
        return;
      }

      if (i !== user.player.selected_slot) {
        user.player.selected_slot = i;
      }
    }
  });

  client.on("rush", (dir, ackid) => {
    if (user.isPlaying() && user.player.can_use_rush) {
      let dir_vec = common.rush_packet_enum_dirs[dir];

      if (dir_vec !== undefined && dir_vec !== null) {
        if (true) {
          if (dir_vec.getX() !== 0) {
            user.player.velocity.setX(dir_vec.getX() * 20);
          }

          if (dir_vec.getY() !== 0) {
            user.player.velocity.setY(dir_vec.getY() * 20);
          }

          if (!common.is_on_ground(user.player.position)) {
            user.player.can_use_rush = false;
          }

          user.player.action_ack_id = ackid;
          broadcast_state_positions();
        }
      }
    }
  });

  client.on("set_lowered_phys", b => {
    if (user.isPlaying() && typeof b === typeof true) {
      user.player.lowered_phys = b;
      broadcast_state_positions();
    }
  });

  client.on("use_power_up", _ => {
    if (user.isPlaying() && user.player.power_up_slot !== null) {
      user.player.current_power_up = user.player.power_up_slot;
      user.player.power_up_time_left = common.powerup_types[user.player.power_up_slot].duration;
      user.player.power_up_slot = null;

      if (user.player.current_power_up === "instant_heal") {
        user.player.health = 25;
      } else if (user.player.current_power_up === "launch") {
        user.player.velocity.setY(-100);
        user.player.can_use_rush = true;
      }
      broadcast_state();
    }
  });

  client.on('trait_change', data => {
    if (typeof data !== "object") return;
    if (typeof data.weapon !== typeof 1) return;
    if (typeof data.trait !== typeof 1) return;
    if (typeof data.is_increase !== typeof false) return;
    if (user.isPlaying()) {
      let player = user.player;

      if (data.weapon >= player.weapons.length) {
        return;
      }

      if (data.trait >= common.weapon_configurables.length) {
        return;
      }

      let weapon_trait_conf = common.weapon_configurables[data.trait];

      if (data.is_increase) {
        // @TODO fix it!
        if (player.energy >= weapon_trait_conf.cost && player.weapons[data.weapon].conf[weapon_trait_conf.key] < weapon_trait_conf.maxval) {
          player.energy -= weapon_trait_conf.cost;
          player.weapons[data.weapon].conf[weapon_trait_conf.key]++;
        }
      } else {
        if (player.weapons[data.weapon].conf[weapon_trait_conf.key] > 0) {
          player.weapons[data.weapon].conf[weapon_trait_conf.key]--;
          player.energy += weapon_trait_conf.cost;
        }
      }

      broadcast_state();
    }
  })

  client.on('disconnect', _ => {
    console.log("A client has disconnected!");
    if (user.isPlaying()) {
      broadcast_message([{
          color: "darkred",
          text: user.player.name
        },
        {
          color: "#ee1a1a",
          text: " rage quit the arena!"
        }
      ]);

      user.dead();
    }

    delete players[client.id];
    broadcast_state();
  });
});

let last_update = Date.now();
let total_update_ticks = 0;
let frames_counter = 0;
let last_second = Date.now();

function broadcast_message(msg) {
  for (let socket_uuid in players) {
    const user = players[socket_uuid];
    if (user !== null && user.isPlaying()) {
      user.sendMessage(msg);
    }
  }
}

setInterval(_ => {
  let dt = Date.now() - last_update;
  let ticks_passed = dt / ((1 / 60) * 1000);

  frames_counter += 1;

  if (last_second + 1000 < Date.now()) {
    last_second = Date.now();
    console.log("FPS: " + frames_counter);
    frames_counter = 0;
  }

  for (let socket_uuid in players) {
    const user = players[socket_uuid];
    if (user !== null && user.isPlaying()) {
      // Phys application
      common.apply_physics(user.player, ticks_passed, user.player.selected_slot);

      // Rush controller
      if (!user.player.can_use_rush && (common.is_on_ground(user.player.position) || user.player.current_power_up === "infinite_dashes")) {
        user.player.can_use_rush = true;
      }

      if (user.player.current_power_up === "unlimited_ammo") {
        user.player.weapons.forEach(weapon => {
          if (weapon.ammo < 2) {
            weapon.ammo = 2;
            broadcast_state();
          }
        });
      }

      if (total_update_ticks % 100 === 0 && user.player.health < 25) {
        user.player.health += 1;
      }

      if (common.is_on_ground(user.player.position)) {
        let changed = false;

        user.player.weapons.forEach(weapon => {
          if (weapon.ammo < weapon.conf.additional_ground_ammo + 2) {
            weapon.ammo = weapon.conf.additional_ground_ammo + 2;
            changed = true;
          }
        });
        if (changed) {
          broadcast_state();
        }
      }

      // Power ups collection
      common.world.power_up_boxes.forEach(function(box_loc, i) {
        const box_data = power_up_crystal_data[i];

        if (box_data.health === 0 && user.player.position.add(new common.Vector(common.conf.player_size / 2, common.conf.player_size / 2)).distance(new common.Vector(box_loc.x, box_loc.y)) < 50 && user.player.current_power_up === null) {
          let rlist = [];
          for (const key in common.powerup_types) {
            const type_data = common.powerup_types[key];
            rlist = rlist.concat(new Array(type_data.rand_repeat).fill(-1).map(_ => key));
          }
          user.player.power_up_slot = rlist[Math.floor(Math.random() * rlist.length)];
          box_data.health = -1;
          box_data.recharge_time = 15;
          broadcast_state();
        }
      });

      // Void damage
      if (user.player.position.getY() > common.conf.min_kill_y) {
        user.player.velocity.setY(-20);
        user.player.can_use_rush = true;
        user.player.weapons.forEach(function(weapon) {
          weapon.ammo = weapon.conf.additional_ground_ammo + 2;
        });
        // @TODO
        /*user.damage_player(1, [{
          "color": "red",
          "text": "You died by void damage"
        }]);*/
        broadcast_state();
      }
    }
  }

  last_update = Date.now();
  total_update_ticks += 1;
}, 1000 / 60);

setInterval(_ => {
  common.world.power_up_boxes.forEach(function(box_loc, i) {
    const box_data = power_up_crystal_data[i];

    if (box_data.health === -1) {
      box_data.recharge_time--;

      if (box_data.recharge_time === 0) {
        box_data.health = 5;
      }
    }
  });

  for (let socket_uuid in players) {
    const user = players[socket_uuid];
    if (user !== null && user.isPlaying()) {
      if (user.player.current_power_up !== null) {
        user.player.power_up_time_left--;

        if (user.player.power_up_time_left <= 0) {
          user.player.current_power_up = null;
        }
      }
    }
  }
}, 1000);

setInterval(_ => {
  broadcast_state(null, undefined);
}, 500);

let bsc = 0;

function broadcast_state_positions() {
  let packet = {};
  
  for (let sock_uuid in players) {
    let user = players[sock_uuid];
    if (user !== null && user.isPlaying()) {
      packet[user.pub_uuid] = [
        user.player.position.getX(),
        user.player.position.getY(),
        user.player.velocity.getX(),
        user.player.velocity.getY(),
        user.player.lowered_phys
      ];
    }
  }
  
  for (let sock_uuid in players) {
    let user = players[sock_uuid];
    if (user !== null && user.isPlaying()) {
      user.client.emit("heartbeat-slim", packet);
    }
  }
}

function broadcast_state(single_user_only, user_added_data, global_added_data) {
  let update_data = {
    svr_timestamp: common.get_net_ts(),
    glob_add: global_added_data,
    player_data: [],
    disable_collision_indices: common.disable_collision_indices,
    x: bsc
  }

  bsc += 1;

  for (let sock_uuid in players) {
    let user = players[sock_uuid];
    if (user !== null && user.isPlaying()) {
      let ud = {
        pub_uuid: user.pub_uuid,
        name: user.player.name,
        action_ack_id: user.player.action_ack_id,
        pX: user.player.position.getX(),
        pY: user.player.position.getY(),
        vX: user.player.velocity.getX(),
        vY: user.player.velocity.getY(),
        weapons: user.player.weapons,
        health: user.player.health,
        energy: user.player.energy,
        total_energy: user.player.total_energy,
        lowered_phys: user.player.lowered_phys,
        death_reason: user.player.death_reason,
        power_up_slot: user.player.power_up_slot,
        current_power_up: user.player.current_power_up,
        power_up_time_left: user.player.power_up_time_left,
        selected_slot: user.player.selected_slot,
        can_rush: user.player.can_use_rush
      }

      update_data.player_data.push(ud);
    }
  }

  update_data.power_up_crystal_data = power_up_crystal_data;

  if (!(single_user_only instanceof common.Player)) {
    for (let sock_uuid in players) {
      let user = players[sock_uuid];
      if (user !== null && user.isPlaying()) {
        update_data.my_pub_uuid = user.pub_uuid;

        if (typeof user_added_data === "object" && user_added_data[user.pub_uuid] !== undefined) {
          update_data.extra_data = user_added_data[user.pub_uuid];
        } else {
          update_data.extra_data = {};
        }

        user.client.emit('heartbeat', update_data);
      }
    }
  } else {
    update_data.my_pub_uuid = single_user_only.pub_uuid;
    single_user_only.client.emit('heartbeat', update_data);
  }
}

setInterval(() => {
  leaderboard_data.forEach(category => {
    category.scores = category.scores.filter(score => {
      return score.added + category.m_duration * (1000 * 60) > Date.now()
    });
  });
  fs.writeFile(leaderboard_path, JSON.stringify(leaderboard_data), 'utf-8', function() {
    console.log("Saved leaderboard!");
  });
}, 1000 * 30);

server.listen(80);
console.log("Game is online on port 80!");