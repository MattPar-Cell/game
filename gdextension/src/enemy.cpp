#include "enemy.h"
#include "game.h"
#include "player.h"

#include <godot_cpp/classes/box_mesh.hpp>
#include <godot_cpp/classes/quad_mesh.hpp>
#include <godot_cpp/classes/collision_shape3d.hpp>
#include <godot_cpp/classes/capsule_shape3d.hpp>
#include <godot_cpp/classes/world3d.hpp>
#include <godot_cpp/classes/physics_direct_space_state3d.hpp>
#include <godot_cpp/classes/physics_ray_query_parameters3d.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <godot_cpp/core/math.hpp>

using namespace godot;

static const double PI = 3.141592653589793;

Enemy::Enemy() {}
Enemy::~Enemy() {}
void Enemy::_bind_methods() {}

Ref<StandardMaterial3D> Enemy::mat(const Color &c, float rough, float metal) {
	Ref<StandardMaterial3D> m; m.instantiate();
	m->set("albedo_color", c);
	m->set("roughness", rough);
	m->set("metallic", metal);
	return m;
}

MeshInstance3D *Enemy::part(const Vector3 &size, const Vector3 &pos, const Ref<Material> &m) {
	Ref<BoxMesh> box; box.instantiate(); box->set_size(size);
	MeshInstance3D *mi = memnew(MeshInstance3D);
	mi->set_mesh(box);
	mi->set_material_override(m);
	mi->set_position(pos);
	add_child(mi);
	return mi;
}

void Enemy::_ready() {
	health = max_health;
	CollisionShape3D *col = memnew(CollisionShape3D);
	Ref<CapsuleShape3D> cap; cap.instantiate();
	cap->set_radius(0.4); cap->set_height(1.7);
	col->set_shape(cap);
	col->set_position(Vector3(0, 0.9, 0));
	add_child(col);
	build_model();
}

void Enemy::build_model() {
	Ref<StandardMaterial3D> fatigue = mat(Color(0.28, 0.26, 0.18));
	Ref<StandardMaterial3D> gear = mat(Color(0.11, 0.12, 0.14), 0.7f, 0.15f);
	Ref<StandardMaterial3D> skin = mat(Color(0.54, 0.35, 0.24), 0.7f);
	Ref<StandardMaterial3D> vest = mat(Color(0.16, 0.18, 0.13), 0.6f, 0.2f);

	part(Vector3(0.5, 0.7, 0.28), Vector3(0, 1.15, 0), fatigue);
	part(Vector3(0.54, 0.5, 0.32), Vector3(0, 1.22, 0), vest);
	part(Vector3(0.44, 0.3, 0.26), Vector3(0, 0.78, 0), gear);
	part(Vector3(0.26, 0.28, 0.26), Vector3(0, 1.68, 0), skin);
	part(Vector3(0.3, 0.16, 0.3), Vector3(0, 1.8, 0), gear);
	part(Vector3(0.13, 0.55, 0.13), Vector3(-0.33, 1.2, 0.05), fatigue);
	part(Vector3(0.13, 0.55, 0.13), Vector3(0.33, 1.2, 0.05), fatigue);
	leg_l = part(Vector3(0.16, 0.72, 0.18), Vector3(-0.13, 0.4, 0), gear);
	leg_r = part(Vector3(0.16, 0.72, 0.18), Vector3(0.13, 0.4, 0), gear);
	part(Vector3(0.06, 0.1, 0.5), Vector3(0.2, 1.3, -0.25), mat(Color(0.06, 0.07, 0.09), 0.5f, 0.4f));

	Ref<QuadMesh> q; q.instantiate(); q->set_size(Vector2(1.0, 0.12));
	hp_mat.instantiate();
	hp_mat->set("albedo_color", Color(0.2, 0.88, 0.75));
	hp_mat->set("emission_enabled", true);
	hp_mat->set("emission", Color(0.2, 0.88, 0.75));
	hp_mat->set("emission_energy_multiplier", 1.5);
	hp_mat->set("billboard_mode", StandardMaterial3D::BILLBOARD_ENABLED);
	hp_mat->set("shading_mode", StandardMaterial3D::SHADING_MODE_UNSHADED);
	q->set_material(hp_mat);
	hp_bar = memnew(MeshInstance3D);
	hp_bar->set_mesh(q);
	hp_bar->set_position(Vector3(0, 2.05, 0));
	add_child(hp_bar);
}

void Enemy::_physics_process(double delta) {
	if (dying) {
		death_t += delta;
		double k = MIN(1.0, death_t / 0.6);
		set_rotation(Vector3(-k * PI / 2.0, get_rotation().y, 0));
		Vector3 v = get_velocity();
		v.y -= gravity * delta;
		set_velocity(v);
		move_and_slide();
		if (death_t > 4.0) queue_free();
		return;
	}
	if (target == nullptr || !UtilityFunctions::is_instance_valid(target)) return;

	Vector3 to_player = target->get_global_position() - get_global_position();
	to_player.y = 0;
	double dist = to_player.length();
	to_player = to_player.normalized();

	double yaw = Math::atan2(to_player.x, to_player.z);
	double cur_yaw = get_rotation().y;
	set_rotation(Vector3(0, Math::lerp_angle(cur_yaw, yaw, CLAMP(delta * 6.0, 0.0, 1.0)), 0));

	Vector3 desired;
	bool los = line_of_sight();
	if (dist > 22.0 || !los) {
		desired = to_player * speed;
	} else {
		strafe_t -= delta;
		if (strafe_t <= 0.0) { strafe_dir *= -1.0; strafe_t = UtilityFunctions::randf_range(1.0, 2.5); }
		Vector3 right(to_player.z, 0, -to_player.x);
		desired = right * strafe_dir * speed * 0.7;
		if (dist < 14.0) desired -= to_player * speed * 0.4;
		fire_cd -= delta;
		if (fire_cd <= 0.0 && los) { fire_cd = fire_rate; shoot(); }
	}

	Vector3 v = get_velocity();
	v.x = Math::lerp(v.x, desired.x, CLAMP(delta * 6.0, 0.0, 1.0));
	v.z = Math::lerp(v.z, desired.z, CLAMP(delta * 6.0, 0.0, 1.0));
	if (!is_on_floor()) v.y -= gravity * delta;
	else v.y = 0.0;
	set_velocity(v);
	move_and_slide();

	anim_t += delta * get_velocity().length() * 2.2;
	double swing = Math::sin(anim_t) * CLAMP(get_velocity().length() / speed, 0.0, 1.0);
	if (leg_l) leg_l->set_rotation(Vector3(swing * 0.8, 0, 0));
	if (leg_r) leg_r->set_rotation(Vector3(-swing * 0.8, 0, 0));
}

bool Enemy::line_of_sight() {
	if (target == nullptr) return false;
	Vector3 from = get_global_position() + Vector3(0, 1.5, 0);
	Vector3 to = target->get_global_position() + Vector3(0, 1.2, 0);
	PhysicsDirectSpaceState3D *space = get_world_3d()->get_direct_space_state();
	Ref<PhysicsRayQueryParameters3D> q = PhysicsRayQueryParameters3D::create(from, to);
	q->set_collision_mask(1 << 0); // world only
	Dictionary hit = space->intersect_ray(q);
	return hit.is_empty();
}

void Enemy::shoot() {
	if (target == nullptr) return;
	double dist = get_global_position().distance_to(target->get_global_position());
	double chance = accuracy * CLAMP(1.0 - dist / 60.0, 0.15, 1.0);
	if (UtilityFunctions::randf() < chance) {
		Player *p = Object::cast_to<Player>(target);
		if (p) p->take_damage(damage);
	}
}

void Enemy::take_damage(double amount, bool headshot) {
	if (dying) return;
	health -= amount;
	double t = CLAMP(health / max_health, 0.0, 1.0);
	hp_bar->set_scale(Vector3(MAX(0.02, t), 1, 1));
	Color c = t > 0.5 ? Color(0.2, 0.88, 0.75) : (t > 0.25 ? Color(1, 0.69, 0.13) : Color(1, 0.23, 0.3));
	hp_mat->set("albedo_color", c);
	hp_mat->set("emission", c);
	if (health <= 0.0) die(headshot);
}

void Enemy::die(bool headshot) {
	dying = true;
	death_t = 0.0;
	if (hp_bar) hp_bar->set_visible(false);
	set_collision_layer(0);
	if (game) game->on_enemy_died(this, headshot);
}
