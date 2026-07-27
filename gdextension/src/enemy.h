#pragma once

#include <godot_cpp/classes/character_body3d.hpp>
#include <godot_cpp/classes/mesh_instance3d.hpp>
#include <godot_cpp/classes/standard_material3d.hpp>

using namespace godot;

class Game;

// Hostile soldier: procedurally modelled, chase/strafe AI with a
// line-of-sight-gated fire, located (headshot) damage, and a death topple.
class Enemy : public CharacterBody3D {
	GDCLASS(Enemy, CharacterBody3D)

public:
	Game *game = nullptr;
	Node3D *target = nullptr;
	double max_health = 100.0;
	double damage = 8.0;

	Enemy();
	~Enemy();

	void _ready() override;
	void _physics_process(double delta) override;

	void take_damage(double amount, bool headshot);

protected:
	static void _bind_methods();

private:
	double health = 100.0;
	double speed = 3.6;
	double accuracy = 0.6;
	double fire_cd = 0.0, fire_rate = 0.9;
	double strafe_dir = 1.0, strafe_t = 0.0;
	double anim_t = 0.0, gravity = 20.0;
	bool dying = false;
	double death_t = 0.0;

	MeshInstance3D *leg_l = nullptr;
	MeshInstance3D *leg_r = nullptr;
	MeshInstance3D *hp_bar = nullptr;
	Ref<StandardMaterial3D> hp_mat;

	void build_model();
	MeshInstance3D *part(const Vector3 &size, const Vector3 &pos, const Ref<Material> &mat);
	Ref<StandardMaterial3D> mat(const Color &c, float rough = 0.8f, float metal = 0.05f);
	bool line_of_sight();
	void shoot();
	void die(bool headshot);
};
