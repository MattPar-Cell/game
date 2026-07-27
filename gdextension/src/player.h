#pragma once

#include <godot_cpp/classes/character_body3d.hpp>
#include <godot_cpp/classes/node3d.hpp>
#include <godot_cpp/classes/camera3d.hpp>
#include <godot_cpp/classes/omni_light3d.hpp>
#include <godot_cpp/classes/mesh_instance3d.hpp>
#include <godot_cpp/classes/capsule_shape3d.hpp>
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/classes/material.hpp>

using namespace godot;

class Game;

struct WeaponDef {
	String name;
	double rpm;
	double dmg;
	int mag;
	int reserve;
	bool automatic;
	double spread;
	double ads_spread;
	double recoil;
	double ads_fov;
	double reload;
	double hs;
	double range;
};

// First-person controller: movement, mouse-look with recoil, a procedural
// weapon viewmodel, and hitscan firing with spread / ADS / reload.
class Player : public CharacterBody3D {
	GDCLASS(Player, CharacterBody3D)

public:
	Game *game = nullptr;

	Player();
	~Player();

	void _ready() override;
	void _input(const Ref<InputEvent> &event) override;
	void _physics_process(double delta) override;

	void take_damage(double amount);
	void heal(double amount);

	// exposed for the HUD
	int get_mag() const { return mag; }
	int get_reserve() const { return reserve; }
	double get_health() const { return health; }
	String get_weapon_name() const { return weapon_name; }
	bool is_reloading() const { return reloading; }

protected:
	static void _bind_methods();

private:
	Node3D *head = nullptr;
	Camera3D *camera = nullptr;
	Node3D *view_weapon = nullptr;
	OmniLight3D *muzzle_flash = nullptr;
	MeshInstance3D *flash_mesh = nullptr;
	Ref<CapsuleShape3D> capsule;

	// movement
	double speed_walk = 5.4, speed_sprint = 8.8, speed_crouch = 2.8;
	double accel = 12.0, jump_force = 6.2, gravity = 20.0, mouse_sens = 0.0025;
	double pitch = 0.0;
	double stand_height = 1.7, crouch_height = 1.1;
	bool aiming = false, sprinting = false;

	// recoil / motion
	Vector2 punch, punch_vel;
	double bob_t = 0.0;
	double base_fov = 78.0;
	double flash_time = 0.0;
	double ads_blend = 0.0;

	// health
	double health = 100.0, max_health = 100.0;

	// weapons
	WeaponDef weapons[3];
	int mag_store[3];
	int reserve_store[3];
	int cur = 0;
	int mag = 30, reserve = 210;
	String weapon_name = "M4-X CARBINE";
	double fire_timer = 0.0;
	bool reloading = false;
	double reload_timer = 0.0;
	bool left_was_down = false;
	double spread_bloom = 0.0;
	bool dead = false;

	void build_viewmodel();
	void gun_part(const Vector3 &size, const Vector3 &pos, const Ref<Material> &mat);
	void update_weapon(double delta, bool moving);
	void fire(const WeaponDef &w);
	void equip(int i);
	void start_reload();
	void finish_reload();
};
