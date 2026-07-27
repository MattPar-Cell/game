#include "player.h"
#include "game.h"
#include "enemy.h"

#include <godot_cpp/classes/box_mesh.hpp>
#include <godot_cpp/classes/sphere_mesh.hpp>
#include <godot_cpp/classes/quad_mesh.hpp>
#include <godot_cpp/classes/collision_shape3d.hpp>
#include <godot_cpp/classes/standard_material3d.hpp>
#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/world3d.hpp>
#include <godot_cpp/classes/physics_direct_space_state3d.hpp>
#include <godot_cpp/classes/physics_ray_query_parameters3d.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <godot_cpp/core/math.hpp>

using namespace godot;

static const double TAU_ = 6.283185307179586;

Player::Player() {}
Player::~Player() {}
void Player::_bind_methods() {}

void Player::_ready() {
	// collision capsule
	capsule.instantiate();
	capsule->set_radius(0.4);
	capsule->set_height(stand_height);
	CollisionShape3D *col = memnew(CollisionShape3D);
	col->set_shape(capsule);
	col->set_position(Vector3(0, stand_height / 2, 0));
	add_child(col);

	head = memnew(Node3D);
	head->set_position(Vector3(0, stand_height, 0));
	add_child(head);

	camera = memnew(Camera3D);
	camera->set_fov(base_fov);
	camera->set_current(true);
	head->add_child(camera);

	build_viewmodel();

	// weapon table: name, rpm, dmg, mag, reserve, auto, spread, ads_spread, recoil, ads_fov, reload, hs, range
	weapons[0] = { "M4-X CARBINE", 720, 26, 30, 210, true, 0.012, 0.0015, 0.028, 55, 2.1, 2.4, 120 };
	weapons[1] = { "VECTOR-9 SMG", 1050, 18, 40, 280, true, 0.02, 0.004, 0.019, 62, 1.8, 2.0, 70 };
	weapons[2] = { "MK.II SIDEARM", 360, 34, 15, 90, false, 0.01, 0.002, 0.036, 58, 1.5, 2.2, 60 };
	for (int i = 0; i < 3; i++) { mag_store[i] = weapons[i].mag; reserve_store[i] = weapons[i].reserve; }
	equip(0);
}

void Player::gun_part(const Vector3 &size, const Vector3 &pos, const Ref<Material> &mat) {
	Ref<BoxMesh> box; box.instantiate(); box->set_size(size);
	MeshInstance3D *m = memnew(MeshInstance3D);
	m->set_mesh(box);
	m->set_material_override(mat);
	m->set_position(pos);
	view_weapon->add_child(m);
}

void Player::build_viewmodel() {
	view_weapon = memnew(Node3D);
	view_weapon->set_position(Vector3(0.18, -0.2, -0.5));
	camera->add_child(view_weapon);

	Ref<StandardMaterial3D> body; body.instantiate();
	body->set("albedo_color", Color(0.09, 0.1, 0.12));
	body->set("roughness", 0.55); body->set("metallic", 0.2);
	Ref<StandardMaterial3D> metal; metal.instantiate();
	metal->set("albedo_color", Color(0.16, 0.17, 0.19));
	metal->set("roughness", 0.34); metal->set("metallic", 0.9);

	gun_part(Vector3(0.09, 0.11, 0.5), Vector3(0, 0, 0), metal);
	gun_part(Vector3(0.07, 0.03, 0.46), Vector3(0, 0.07, 0.02), body);
	gun_part(Vector3(0.05, 0.05, 0.42), Vector3(0, 0.01, -0.42), metal);
	gun_part(Vector3(0.07, 0.07, 0.34), Vector3(0, 0.01, -0.28), body);
	gun_part(Vector3(0.06, 0.22, 0.1), Vector3(0, -0.15, 0.05), body);
	gun_part(Vector3(0.06, 0.16, 0.07), Vector3(0, -0.1, 0.2), body);
	gun_part(Vector3(0.05, 0.09, 0.26), Vector3(0, 0.0, 0.4), body);
	gun_part(Vector3(0.05, 0.06, 0.14), Vector3(0, 0.11, 0.04), metal);

	// reticle dot
	Ref<SphereMesh> dm; dm.instantiate(); dm->set_radius(0.006); dm->set_height(0.012);
	Ref<StandardMaterial3D> de; de.instantiate();
	de->set("albedo_color", Color(0.27, 1.0, 0.6));
	de->set("emission_enabled", true); de->set("emission", Color(0.27, 1.0, 0.6));
	de->set("emission_energy_multiplier", 3.0);
	MeshInstance3D *dot = memnew(MeshInstance3D);
	dot->set_mesh(dm); dot->set_material_override(de); dot->set_position(Vector3(0, 0.11, -0.03));
	view_weapon->add_child(dot);

	// muzzle flash light
	muzzle_flash = memnew(OmniLight3D);
	muzzle_flash->set("light_color", Color(1.0, 0.79, 0.44));
	muzzle_flash->set("light_energy", 0.0);
	muzzle_flash->set("omni_range", 12.0);
	muzzle_flash->set_position(Vector3(0, 0.01, -0.68));
	view_weapon->add_child(muzzle_flash);

	// muzzle flash quad
	Ref<QuadMesh> q; q.instantiate(); q->set_size(Vector2(0.35, 0.35));
	Ref<StandardMaterial3D> fm; fm.instantiate();
	fm->set("albedo_color", Color(1.0, 0.9, 0.6));
	fm->set("emission_enabled", true); fm->set("emission", Color(1.0, 0.85, 0.5));
	fm->set("emission_energy_multiplier", 6.0);
	fm->set("transparency", StandardMaterial3D::TRANSPARENCY_ALPHA);
	fm->set("blend_mode", StandardMaterial3D::BLEND_MODE_ADD);
	fm->set("billboard_mode", StandardMaterial3D::BILLBOARD_ENABLED);
	fm->set("shading_mode", StandardMaterial3D::SHADING_MODE_UNSHADED);
	q->set_material(fm);
	flash_mesh = memnew(MeshInstance3D);
	flash_mesh->set_mesh(q);
	flash_mesh->set_position(Vector3(0, 0.01, -0.72));
	flash_mesh->set_visible(false);
	view_weapon->add_child(flash_mesh);
}

void Player::_input(const Ref<InputEvent> &event) {
	Ref<InputEventMouseMotion> mm = event;
	if (mm.is_valid() && Input::get_singleton()->get_mouse_mode() == Input::MOUSE_MODE_CAPTURED) {
		rotate_y(-mm->get_relative().x * mouse_sens);
		pitch = CLAMP(pitch - mm->get_relative().y * mouse_sens, -1.5, 1.5);
	}
}

void Player::_physics_process(double delta) {
	if (dead) return;
	Input *in = Input::get_singleton();

	Vector3 input_dir;
	if (in->is_action_pressed("move_forward")) input_dir.z -= 1;
	if (in->is_action_pressed("move_back")) input_dir.z += 1;
	if (in->is_action_pressed("move_left")) input_dir.x -= 1;
	if (in->is_action_pressed("move_right")) input_dir.x += 1;
	bool moving = input_dir.length() > 0.01;
	Vector3 dir = (get_global_transform().basis.xform(input_dir)).normalized();

	bool crouching = in->is_action_pressed("crouch");
	sprinting = in->is_action_pressed("sprint") && in->is_action_pressed("move_forward") && !crouching && !aiming;
	double target_speed = speed_walk;
	if (crouching) target_speed = speed_crouch;
	else if (sprinting) target_speed = speed_sprint;
	if (aiming) target_speed *= 0.55;

	Vector3 vel = get_velocity();
	Vector3 hv(vel.x, 0, vel.z);
	Vector3 wish = moving ? dir * target_speed : Vector3();
	hv = hv.lerp(wish, CLAMP(accel * delta, 0.0, 1.0));
	vel.x = hv.x; vel.z = hv.z;

	if (is_on_floor()) {
		if (in->is_action_pressed("jump")) vel.y = jump_force;
	} else {
		vel.y -= gravity * delta;
	}
	set_velocity(vel);
	move_and_slide();

	double target_h = crouching ? crouch_height : stand_height;
	capsule->set_height(Math::lerp(capsule->get_height(), target_h, CLAMP(delta * 12.0, 0.0, 1.0)));
	Vector3 hp = head->get_position();
	hp.y = Math::lerp(hp.y, target_h, CLAMP(delta * 12.0, 0.0, 1.0));
	head->set_position(hp);

	update_weapon(delta, moving);
}

void Player::update_weapon(double delta, bool moving) {
	Input *in = Input::get_singleton();
	aiming = in->is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) && !reloading;

	if (in->is_action_just_pressed("weapon_1")) equip(0);
	if (in->is_action_just_pressed("weapon_2")) equip(1);
	if (in->is_action_just_pressed("weapon_3")) equip(2);
	if (in->is_action_just_pressed("reload")) start_reload();

	if (reloading) {
		reload_timer -= delta;
		if (reload_timer <= 0.0) finish_reload();
	}

	const WeaponDef &w = weapons[cur];
	double target_fov = aiming ? w.ads_fov : (base_fov * (sprinting ? 1.05 : 1.0));
	camera->set_fov(Math::lerp((double)camera->get_fov(), target_fov, CLAMP(delta * 10.0, 0.0, 1.0)));

	fire_timer -= delta;
	bool lmb = in->is_mouse_button_pressed(MOUSE_BUTTON_LEFT);
	bool want = w.automatic ? lmb : (lmb && !left_was_down);
	left_was_down = lmb;
	if (want && !reloading && fire_timer <= 0.0) {
		if (mag <= 0) {
			start_reload();
		} else {
			fire_timer = 60.0 / w.rpm;
			mag -= 1;
			mag_store[cur] = mag;
			fire(w);
		}
	}

	// recoil spring
	punch += punch_vel * (float)delta;
	punch_vel *= MAX(0.0, 1.0 - delta * 18.0);
	punch *= MAX(0.0, 1.0 - delta * 12.0);
	head->set_rotation(Vector3(pitch + punch.x, punch.y, 0));

	// viewmodel ADS/bob pose
	ads_blend = Math::lerp(ads_blend, aiming ? 1.0 : 0.0, CLAMP(delta * 12.0, 0.0, 1.0));
	Vector3 rest(0.18, -0.2, -0.5);
	Vector3 ads(0.0, -0.093, -0.42);
	Vector3 pose = rest.lerp(ads, ads_blend);
	if (moving && is_on_floor()) {
		bob_t += delta * (sprinting ? 13.0 : 9.0);
		double amp = (aiming ? 0.4 : 1.0);
		pose += Vector3(Math::cos(bob_t) * 0.012, Math::abs(Math::sin(bob_t)) * 0.012, 0) * amp;
	}
	view_weapon->set_position(view_weapon->get_position().lerp(pose, CLAMP(delta * 14.0, 0.0, 1.0)));
	spread_bloom = MAX(0.0, spread_bloom - delta * 2.2);

	if (flash_time > 0.0) {
		flash_time -= delta;
		double t = flash_time / 0.05;
		muzzle_flash->set("light_energy", MAX(0.0, t * 5.0));
		flash_mesh->set_visible(true);
	} else {
		muzzle_flash->set("light_energy", 0.0);
		flash_mesh->set_visible(false);
	}
}

void Player::fire(const WeaponDef &w) {
	flash_time = 0.05;
	flash_mesh->set_rotation(Vector3(0, 0, UtilityFunctions::randf() * TAU_));
	punch_vel.x += w.recoil;
	punch_vel.y += UtilityFunctions::randf_range(-1, 1) * w.recoil * 0.4;
	spread_bloom = MIN(1.0, spread_bloom + 0.16);

	double spread = (aiming ? w.ads_spread : w.spread) * (1.0 + spread_bloom * 1.6);
	Transform3D ct = camera->get_global_transform();
	Vector3 from = ct.origin;
	Vector3 fdir = -ct.basis.get_column(2);
	fdir += ct.basis.get_column(0) * UtilityFunctions::randf_range(-1, 1) * spread;
	fdir += ct.basis.get_column(1) * UtilityFunctions::randf_range(-1, 1) * spread;
	fdir = fdir.normalized();
	Vector3 to = from + fdir * w.range;

	PhysicsDirectSpaceState3D *space = get_world_3d()->get_direct_space_state();
	Ref<PhysicsRayQueryParameters3D> q = PhysicsRayQueryParameters3D::create(from, to);
	q->set_collision_mask((1 << 0) | (1 << 2)); // world + enemy
	Dictionary hit = space->intersect_ray(q);
	if (hit.is_empty()) return;

	Node *col = Object::cast_to<Node>(hit["collider"]);
	Enemy *e = Object::cast_to<Enemy>(col);
	Vector3 hpos = hit["position"];
	if (e) {
		bool headshot = hpos.y > e->get_global_position().y + 1.5;
		double dmg = w.dmg * (headshot ? w.hs : 1.0);
		e->take_damage(dmg, headshot);
	} else {
		// impact light flash, faded + freed by Game::_process
		OmniLight3D *spark = memnew(OmniLight3D);
		Vector3 nrm = hit.has("normal") ? (Vector3)hit["normal"] : Vector3(0, 1, 0);
		spark->set_position(hpos + nrm * 0.1);
		spark->set("light_color", Color(1.0, 0.75, 0.4));
		spark->set("light_energy", 2.0);
		spark->set("omni_range", 2.5);
		if (game) {
			game->add_child(spark);
			game->register_spark(spark, 0.12);
		} else {
			spark->queue_free();
		}
	}
}

void Player::equip(int i) {
	cur = i;
	const WeaponDef &w = weapons[i];
	weapon_name = w.name;
	mag = mag_store[i];
	reserve = reserve_store[i];
	reloading = false;
	reload_timer = 0.0;
}

void Player::start_reload() {
	const WeaponDef &w = weapons[cur];
	if (reloading || mag >= w.mag || reserve <= 0) return;
	reloading = true;
	reload_timer = w.reload;
}

void Player::finish_reload() {
	const WeaponDef &w = weapons[cur];
	int need = w.mag - mag;
	int take = MIN(need, reserve);
	mag += take;
	reserve -= take;
	mag_store[cur] = mag;
	reserve_store[cur] = reserve;
	reloading = false;
}

void Player::take_damage(double amount) {
	if (dead) return;
	health = MAX(0.0, health - amount);
	if (health <= 0.0) {
		dead = true;
		if (game) game->announce("YOU DIED", 999.0);
		Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_VISIBLE);
	}
}

void Player::heal(double amount) {
	health = MIN(max_health, health + amount);
}
