(function(exports) {
  exports.Vector = class Vector {
    constructor(x, y) {
      this._x = new exports.LerpNum(x, x, 0);
      this._y = new exports.LerpNum(y, y, 0);
    }

    // Getters and setters
    getX() {
      return exports.round(this._x.getCurrentVal(), 4);
    }

    getY() {
      return exports.round(this._y.getCurrentVal(), 4);
    }

    setX(x, duration) {
      this._x = new exports.LerpNum(this.getX(), x, duration || 0);
    }

    setY(y, duration) {
      this._y = new exports.LerpNum(this.getY(), y, duration || 0);
    }

    setPair(x, y) {
      this.setX(x);
      this.setY(y);
    }

    // Clone
    clone() {
      return new Vector(this.getX(), this.getY());
    }

    // Arithmetic
    mutnegate() {
      this.setX(-this.getX());
      this.setY(-this.getY());
      return this;
    }

    negate() {
      return this.clone().mutnegate();
    }

    mutadd(other) {
      this.setX(this.getX() + other.getX());
      this.setY(this.getY() + other.getY());
      return this;
    }

    add(other) {
      return this.clone().mutadd(other);
    }

    mutsub(other) {
      return this.mutadd(other.clone().negate());
    }

    sub(other) {
      return this.clone().mutsub(other);
    }

    mutmult(other) {
      this.setX(this.getX() * other.getX());
      this.setY(this.getY() * other.getY());
      return this;
    }

    mult(other) {
      return this.clone().mutmult(other);
    }

    mutdiv(other) {
      this.setX(this.getX() / other.getX());
      this.setY(this.getY() / other.getY());
      return this;
    }

    div(other) {
      return this.clone().mutdiv(other);
    }

    len() {
      return Math.sqrt(this.getX() * this.getX() + this.getY() * this.getY());
    }

    mutnormalize() {
      const l = this.len();
      if (l > 0) {
        this.setX(this.getX() / l);
        this.setY(this.getY() / l);
      }

      return this;
    }

    normalized() {
      return this.clone().mutnormalize();
    }

    roundmut(acc) {
      this.setX(exports.round(this.getX(), acc));
      this.setY(exports.round(this.getY(), acc));

      return this;
    }

    round(acc) {
      return this.clone().roundmut(acc || 1);
    }

    mutfloor() {
      this.setX(Math.floor(this.getX()));
      this.setY(Math.floor(this.getY()));

      return this;
    }

    floor() {
      return this.clone().mutfloor();
    }

    distance(other) {
      var a = this.getX() - other.getX();
      var b = this.getY() - other.getY();

      return Math.sqrt(a * a + b * b);
    }

    getdeg() {
      return exports.todeg(Math.atan2(this.getX(), this.getY()));
    }
    
    getrad() {
      return Math.atan2(this.getX(), this.getY());
    }
  }

  exports.testrectcollision = function(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 &&
      x2 < x1 + w1 &&
      y1 < y2 + h2 &&
      y2 < y1 + h1
  }

  exports.is_colliding_with_obj = function(pos, size, return_actual_object, return_list_mode) {
    let cobj = null;
    let cobjs = [];
    exports.world.tiles.forEach((obj, i) => {
      if (obj.layer === "obj") {
        if (exports.disable_collision_indices[i] === true) {
          if (new exports.Vector(obj.x + obj.w / 2, obj.y + obj.h / 2).distance(pos) < 30) {
            obj.collision_world_index = i;
            cobj = obj;
            cobjs.push(obj);
          }
        }
        
        if (exports.disable_collision_indices[i] !== true && exports.testrectcollision(obj.x, obj.y, obj.w, obj.h, pos.getX(), pos.getY(), size.getX(), size.getY())) {
          obj.collision_world_index = i;
          cobj = obj;
          cobjs.push(obj);
        }
      }
    });

    if (return_list_mode && return_actual_object) {
      return cobjs;
    }

    return return_actual_object !== true ? cobj !== null : cobj;
  }

  exports.canMoveInDir = function(loc, vec, cs_collider) {
    return exports.canMoveInDirROBJ(loc, vec, cs_collider) === null;
  }

  exports.canMoveInDirROBJ = function(loc, vec, cs_collider) {
    const objs = exports.is_colliding_with_obj(loc.add(vec), cs_collider || new exports.Vector(exports.conf.player_size, exports.conf.player_size), true, true).filter(obj => {
      if (typeof obj.one_way === "number") {
        const axis = obj.one_way < 2 ? "x" : "y";
        const positive = obj.one_way % 2 !== 0;

        if (exports.is_colliding_with_obj(loc, cs_collider || new exports.Vector(exports.conf.player_size, exports.conf.player_size), true)) {
          return false;
        }

        const v = (axis === "x" ? vec.getX() : vec.getY());

        if ((positive && v > 0) || (!positive && v < 0)) {
          return false;
        }
      }
      return true;
    });

    return objs.length > 0 ? objs[0] : null;
  }

  exports.is_on_ground = function(player) {
    return !exports.canMoveInDir(player.position, new exports.Vector(0, player.get_active_weapon().conf.gravmod > 2 ? -2 : 2));
  }

  exports.Ray = class {
    constructor() {
      this.starting_pos = new exports.Vector(0, 0);
      this.chkstep = 1;
      this.pos = this.starting_pos.clone();
      this.direction = new exports.Vector(0, 0);
      this.max_dist = 8;
      this.world_collidable = true;
      this.size = 1;
      this.last_collided_object = null;

      this.gravity = 0;

      this.extra_check = function() {
        return true;
      };
    }

    get_size_vec() {
      return new exports.Vector(this.size * 2, this.size * 2);
    }

    trace() {
      const pos_sub = this.get_size_vec().div(new exports.Vector(2, 2));
      const size_vec = this.get_size_vec();
      this.hidden_dy = this.direction.normalized().getY();

      this.path = [this.starting_pos.clone(new exports.Vector(this.size, this.size))];
      this.pos = this.starting_pos.clone();
      
      let step = 0;

      for (let d = 0; d < this.max_dist; d++) {
        let should_check = step % this.chkstep === 0;
        if (should_check ? this.extra_check() : true) {
          let collided_with = should_check ? exports.canMoveInDirROBJ(this.pos.sub(pos_sub), this.direction, size_vec) : null;
          
          this.last_collided_object = collided_with;
          
          if (collided_with === null || !this.world_collidable || collided_with.bullet_phased) {
            this.pos.mutadd(this.direction.normalized());
            this.hidden_dy += this.gravity / 1000;

            if (Math.abs(this.direction.getY() - this.hidden_dy) > 0.1) {
              this.direction.setY(this.hidden_dy);
              this.path.push(this.pos.clone());
            }
          } else if (collided_with.reflective) {
            if (exports.canMoveInDir(this.pos.sub(pos_sub), new exports.Vector(-this.direction.getX(), this.direction.getY()), size_vec)) {
              this.direction.setX(-this.direction.getX());
            } else {
              this.direction.setY(-this.direction.getY());
              this.hidden_dy = this.direction.getY();
            }

            this.path.push(this.pos.clone());

            this.pos.mutadd(this.direction.normalized());
          } else {
            break;
          }
        } else {
          break;
        }
        
        step += 1;
      }

      this.path.push(this.pos.clone());
    }
  }

  exports.apply_physics = function(player, ticks, is_in_flash) {
    let c = (player.lowered_phys ? 0.2 : 0.8) + (player.get_active_weapon().conf.additional_launching_power * 0.06);
    
    const dist = Math.min(
      Math.abs(player.position.getY() - exports.conf.tpzone_top),
      Math.abs(player.position.getY() - exports.conf.tpzone_bottom)
    );
    
    if (dist < 400) {
      c = dist * dist / 160000 + 0.2;
    }

    if (player.lowered_phys) {
      c = 0;
    }
    
    ticks = ticks * c;
    const vel_with_delta = player.velocity.mult(new exports.Vector(ticks, ticks));

    if (vel_with_delta.getY() < 50) {
      player.velocity.mutadd(new exports.Vector(0, ticks * (1.25 - player.get_active_weapon().conf.gravmod * 0.5)));
    } else {
      vel_with_delta.setY(50);
    }

    // Move object
    for (let x = 0; x < Math.floor(Math.abs(vel_with_delta.getX())); x++) {
      let collided_obj = exports.canMoveInDirROBJ(player.position, new exports.Vector(Math.sign(vel_with_delta.getX()), 0));

      if (collided_obj == null) {
        player.position.setX(player.position.getX() + Math.sign(vel_with_delta.getX()));
      } else if (collided_obj.bouncy) {
        player.velocity.setX(-player.velocity.getX());
        break;
      }

      let a = Math.min(Math.abs(player.velocity.getX()), 0.4 / 3) * -Math.sign(player.velocity.getX());
      player.velocity.setX(player.velocity.getX() + a);
    }

    for (let x = 0; x < Math.abs(vel_with_delta.getY()); x++) {
      let collided_obj = exports.canMoveInDirROBJ(player.position, new exports.Vector(0, Math.sign(vel_with_delta.getY())));

      if (collided_obj === null) {
        player.position.setY(player.position.getY() + Math.sign(vel_with_delta.getY()));
      } else if (collided_obj.bouncy) {
        player.velocity.setY(player.velocity.getY() * -0.99);
      } else {
        player.velocity.setY(0);
      }
    }
    
    if (player.position.getY() > exports.conf.tpzone_bottom && player.velocity.getY() > 0) {
      player.position.setY(exports.conf.tpzone_top);
      player.velocity.setY(20);
    }
    
    if (player.position.getY() < exports.conf.tpzone_top && player.velocity.getY() < 0) {
      player.position.setY(exports.conf.tpzone_bottom);
      player.velocity.setY(-20);
    }

    //player.position.setX(exports.round(player.position.getX(), 2));
    player.velocity.setX(exports.round(player.velocity.getX(), 1));
  }

  exports.Player = class {
    constructor(name) {
      this.position = new exports.Vector(10, 10);
      this.client_interp_position = new exports.Vector(10, 10);
      this.velocity = new exports.Vector(0, 0);
      this.action_ack_id = null;
      this.health = 25;
      this.energy = 18;
      this.total_energy = 18;
      this.can_use_rush = true;
      this.name = name;
      this.lowered_phys = false;
      this.power_up_slot = null;
      this.current_power_up = null;
      this.power_up_time_left = 0;
      this.selected_slot = 0;
      this.weapons = [{
          ammo: 2,
          cli_internal: {
            back_anim: 0
          },
          conf: {
            additional_ground_ammo: 0,
            additional_barrels: 0,
            additional_callibur: 0,
            additional_size: 0,
            additional_launching_power: 0,
            suck_mode: 0,
            bullet_gravity: 0,
            scope: 0,
            lingering_trails: 0,
            trail_color: 0,
            teleportation: 0,
            fire_rate: 0,
            gravmod: 0,
          }
        },
        {
          ammo: 2,
          cli_internal: {
            back_anim: 0
          },
          conf: {
            additional_ground_ammo: 0,
            additional_barrels: 0,
            additional_size: 0,
            additional_callibur: 0,
            additional_launching_power: 0,
            bullet_gravity: 0,
            suck_mode: 0,
            scope: 0,
            lingering_trails: 0,
            trail_color: 0,
            teleportation: 0,
            fire_rate: 0,
            gravmod: 0,
          }
        },
        {
          ammo: 2,
          cli_internal: {
            back_anim: 0
          },
          conf: {
            additional_ground_ammo: 0,
            additional_barrels: 0,
            additional_size: 0,
            additional_callibur: 0,
            additional_launching_power: 0,
            bullet_gravity: 0,
            suck_mode: 0,
            scope: 0,
            lingering_trails: 0,
            trail_color: 0,
            teleportation: 0,
            fire_rate: 0,
            gravmod: 0,
          }
        }
      ]
    }
    
    get_active_weapon() {
      return this.weapons[this.selected_slot];
    }
  }

  exports.weapon_configurables = [{
      key: "additional_ground_ammo",
      name: "Additional ammo",
      maxval: 4,
      cost: 3
    },
    {
      key: "additional_callibur",
      name: "Additional callibur",
      maxval: 6,
      cost: 4
    },
    {
      key: "fire_rate",
      name: "Faster Fire",
      maxval: 4,
      cost: 4,
    },
    {
      key: "additional_barrels",
      name: "Additional Barrels",
      maxval: 3,
      cost: 7
    },
    {
      key: "suck_mode",
      name: "Suck Mode",
      maxval: 1,
      cost: 10
    },
    {
      key: "additional_size",
      name: "Bigger bullet size",
      maxval: 5,
      cost: 3
    },
    {
      key: "additional_launching_power",
      name: "Additional proppelling",
      maxval: 5,
      cost: 3
    },
    {
      key: "bullet_gravity",
      name: "Bullet Gravity",
      maxval: 4,
      cost: 2
    },
    {
      key: "scope",
      name: "Scope",
      maxval: 7,
      cost: 2
    },
    /*{
      key: "lingering_trails",
      name: "Bullet Distractions",
      maxval: 5,
      cost: 6
    },*/
    {
      key: "trail_color",
      name: "Trail Color",
      maxval: 10,
      cost: 0
    },
    {
      key: "gravmod",
      name: "Gravity--",
      maxval: 4,
      cost: 4
    },
    {
      key: "teleportation",
      name: "Teleportation",
      maxval: 4,
      cost: 4
    },
  ]

  exports.round = function(x, n) {
    return Math.floor(x * Math.pow(10, n)) / Math.pow(10, n);
  }

  exports.LerpNum = class LerpNum {
    constructor(start_val, end_val, time, start_in) {
      this.start_val = start_val;
      this.end_val = end_val;

      this.start_time = Date.now() + (start_in || 0);
      this.duration = time;
    }

    getCurrentVal() {
      function limit(x, m) {
        return x > m ? m : x;
      }

      if (this.duration === 0) {
        return this.end_val;
      }

      if (Date.now() < this.start_time) {
        return this.start_val;
      }

      return ((this.end_val - this.start_val) / this.duration) * limit(Date.now() - this.start_time, this.duration) + this.start_val;
    }
  }


  exports.is_valid_username = function(username) {
    // @TODO validate
    if (username.length === 0) {
      return "Please fill in this field.";
    }

    if (username.length > 25) {
      return "That name is too long";
    }

    return null;
  }

  exports.torad = function(deg) {
    return deg * (Math.PI / 180);
  }

  exports.todeg = function(rad) {
    return rad * 180 / Math.PI;
  }

  exports.rush_packet_enum_dirs = {
    left: new exports.Vector(-1, 0),
    right: new exports.Vector(1, 0),
    down: new exports.Vector(0, 1),
    up: new exports.Vector(0, -1)
  }

  exports.powerup_types = {
    invisibility: {
      name: "Invisibility",
      bg_color: "lightblue",
      duration: 20,
      rand_repeat: 2
    },
    infinite_dashes: {
      name: "Infinite dashes",
      bg_color: "yellow",
      duration: 15,
      rand_repeat: 3
    },
    /*extra_bounty: {
      name: "Extra bounty",
      bg_color: "gold",
      duration: 30,
      rand_repeat: 3
    },*/
    /*launch: {
      name: "Launch!",
      bg_color: "orange",
      duration: 0,
      rand_repeat: 3
    },*/
    instant_heal: {
      name: "Instant heal",
      bg_color: "red",
      duration: 0,
      rand_repeat: 2
    },
    faze_bullet: {
      name: "Bullet faze",
      description: "(phases through anything!)",
      bg_color: "#aaa",
      duration: 30,
      rand_repeat: 1
    },
    unlimited_ammo: {
      name: "Unlimited ammo",
      bg_color: "brown",
      duration: 15,
      rand_repeat: 1
    },
    /*flashy_bullets: {
      name: "Extra Flash",
      bg_color: "#fff",
      duration: 7,
      rand_repeat: 2
    }*/
  }

  // @TODO CLEARLY CLIENT PLZ MOVE BEFORE WORLD EXPLODES
  exports.hslToRgb = function(h, s, l) {
    var r, g, b;

    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      var hue2rgb = function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }

      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  
  exports.get_teleportation_vec = function(dir, level) {
    return dir.mult(new exports.Vector(level * 100, level * 100));
  }
  
  exports.get_teleportation_punish = function(level) {
    return level * 0.5;
  }

  exports.apply_gun_forces = function(player, gun_dir_vec, weapon, optional_client) {
    const is_grounded = exports.is_on_ground(player);
    const tpvec = exports.get_teleportation_vec(gun_dir_vec, weapon.conf.teleportation);
    
    if (exports.canMoveInDir(player.position, tpvec)) {
      player.position.mutadd(tpvec);
    }
  
    if (weapon.conf.teleportation === 0) {
      player.velocity = gun_dir_vec.mult(
        new exports.Vector(is_grounded ? 40 : 30, is_grounded ? 40 : 30).add(new exports.Vector(weapon.conf.additional_launching_power * 1.5, weapon.conf.additional_launching_power * 1.5))
      ).negate();
    }

    if (weapon.conf.suck_mode) {
      player.velocity.mutnegate();
    }
  }
  
  exports.get_firerate_multiplier = function(level) {
    return 1 - (0.1 * level);
  }

  exports.world = {};

  exports.conf = {};

  exports.get_net_ts = function() {
    return Date.now();
  }

  exports.apply_config = function(conf_jsn) {
    exports.conf = conf_jsn.conf;
    exports.world = conf_jsn.map_data;
  }
  
  exports.disable_collision_indices = {} // (HashMap<index : int, garbage_data : bool>)
}(
  typeof module === "object" && typeof module.exports === "object" ? module.exports : window.rebound_common = {}
));