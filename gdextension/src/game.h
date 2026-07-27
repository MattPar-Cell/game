#pragma once

#include <godot_cpp/classes/node3d.hpp>
#include <godot_cpp/classes/standard_material3d.hpp>
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/templates/vector.hpp>

namespace godot {
class Material;
}

using namespace godot;

class Player;
class Enemy;

// Top-level orchestrator: builds the environment + level, spawns the player
// and enemy waves, and drives the HUD. Registered as a Node3D you can drop
// into a scene (see demo/Main.tscn).
class Game : public Node3D {
	GDCLASS(Game, Node3D)

public:
	// collision layer bit indices (0-based)
	static const int L_WORLD = 0;
	static const int L_PLAYER = 1;
	static const int L_ENEMY = 2;

	Game();
	~Game();

	void _ready() override;
	void _process(double delta) override;
	void _unhandled_input(const Ref<InputEvent> &event) override;

	void announce(const String &text, double dur = 2.2);
	void on_enemy_died(Node *e, bool headshot);

	// spark FX pool cleanup helper (public so Player can register sparks)
	void register_spark(Node3D *light, double ttl);

protected:
	static void _bind_methods();

private:
	Player *player = nullptr;
	Vector<Enemy *> enemies;
	Vector<Vector3> spawn_points;

	int wave = 0;
	int enemies_to_spawn = 0;
	double spawn_timer = 0.0;
	double intermission = 2.0;
	String state = "intermission";
	int score = 0;
	double announce_timer = 0.0;

	// timed FX (impact light flashes)
	struct Spark { Node3D *node; double ttl; double max_ttl; };
	Vector<Spark> sparks;

	// HUD
	Label *hud_health = nullptr;
	Label *hud_ammo = nullptr;
	Label *hud_weapon = nullptr;
	Label *hud_wave = nullptr;
	Label *hud_score = nullptr;
	Label *hud_hostiles = nullptr;
	Label *hud_announce = nullptr;
	Label *hud_reload = nullptr;
	Control *crosshair = nullptr;

	void register_input();
	void build_environment();
	void build_level();
	void spawn_player();
	void build_hud();
	void start_next_wave();
	void spawn_enemy();

	// material + geometry helpers
	Ref<StandardMaterial3D> mat_ground(const Color &dark, const Color &light, float uv, float freq, float nfreq);
	Ref<StandardMaterial3D> mat_solid(const Color &c, float rough, float metal, float nfreq = 0.0f, float uv = 1.0f);
	Ref<StandardMaterial3D> mat_glass();
	Ref<StandardMaterial3D> mat_emissive(const Color &c, float energy);
	Node3D *add_box(const Vector3 &size, const Vector3 &pos, const Ref<Material> &mat, bool collide = true, float rot_y = 0.0f);
	void building(const Vector3 &base, float w, float d, float h, const Ref<Material> &body, const Ref<Material> &trim);
	void tower(const Vector3 &base, const Ref<Material> &body, const Ref<Material> &steel);
	void sandbags(const Vector3 &pos, float rot, int count, const Ref<Material> &mat);
	void barrel(const Vector3 &pos, const Ref<Material> &mat);

	Label *mk_label(Node *parent, const String &text, int size, const Color &color);
	static void anchor(Control *c, float l, float t, float r, float b);
};
