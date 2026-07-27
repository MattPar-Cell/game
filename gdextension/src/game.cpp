#include "game.h"
#include "player.h"
#include "enemy.h"

#include <godot_cpp/classes/box_mesh.hpp>
#include <godot_cpp/classes/box_shape3d.hpp>
#include <godot_cpp/classes/cylinder_mesh.hpp>
#include <godot_cpp/classes/cylinder_shape3d.hpp>
#include <godot_cpp/classes/collision_shape3d.hpp>
#include <godot_cpp/classes/static_body3d.hpp>
#include <godot_cpp/classes/mesh_instance3d.hpp>
#include <godot_cpp/classes/directional_light3d.hpp>
#include <godot_cpp/classes/world_environment.hpp>
#include <godot_cpp/classes/environment.hpp>
#include <godot_cpp/classes/sky.hpp>
#include <godot_cpp/classes/procedural_sky_material.hpp>
#include <godot_cpp/classes/fast_noise_lite.hpp>
#include <godot_cpp/classes/noise_texture2d.hpp>
#include <godot_cpp/classes/gradient.hpp>
#include <godot_cpp/classes/canvas_layer.hpp>
#include <godot_cpp/classes/color_rect.hpp>
#include <godot_cpp/classes/input.hpp>
#include <godot_cpp/classes/input_map.hpp>
#include <godot_cpp/classes/input_event_key.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <godot_cpp/core/math.hpp>

using namespace godot;

static const double PI = 3.141592653589793;

Game::Game() {}
Game::~Game() {}

void Game::_bind_methods() {}

void Game::_ready() {
	UtilityFunctions::randomize();
	register_input();
	build_environment();
	build_level();
	spawn_player();
	build_hud();
	Input::get_singleton()->set_mouse_mode(Input::MOUSE_MODE_CAPTURED);
}

// --------------------------------------------------------------- input
void Game::register_input() {
	Dictionary binds;
	binds["move_forward"] = KEY_W; binds["move_back"] = KEY_S;
	binds["move_left"] = KEY_A; binds["move_right"] = KEY_D;
	binds["jump"] = KEY_SPACE; binds["sprint"] = KEY_SHIFT; binds["crouch"] = KEY_CTRL;
	binds["reload"] = KEY_R; binds["weapon_1"] = KEY_1; binds["weapon_2"] = KEY_2; binds["weapon_3"] = KEY_3;
	InputMap *im = InputMap::get_singleton();
	Array keys = binds.keys();
	for (int i = 0; i < keys.size(); i++) {
		String action = keys[i];
		if (!im->has_action(action)) {
			im->add_action(action);
			Ref<InputEventKey> ev;
			ev.instantiate();
			ev->set_physical_keycode((Key)(int)binds[action]);
			im->action_add_event(action, ev);
		}
	}
}

void Game::_unhandled_input(const Ref<InputEvent> &event) {
	Ref<InputEventKey> k = event;
	if (k.is_valid() && k->is_pressed() && k->get_keycode() == KEY_ESCAPE) {
		Input *in = Input::get_singleton();
		in->set_mouse_mode(in->get_mouse_mode() == Input::MOUSE_MODE_CAPTURED
				? Input::MOUSE_MODE_VISIBLE : Input::MOUSE_MODE_CAPTURED);
	}
}

// --------------------------------------------------------------- environment
void Game::build_environment() {
	DirectionalLight3D *sun = memnew(DirectionalLight3D);
	sun->set_rotation_degrees(Vector3(-48, 42, 0));
	sun->set("light_color", Color(1.0, 0.94, 0.82));
	sun->set("light_energy", 1.6);
	sun->set("shadow_enabled", true);
	sun->set("directional_shadow_mode", DirectionalLight3D::SHADOW_PARALLEL_4_SPLITS);
	sun->set("directional_shadow_max_distance", 200.0);
	sun->set("light_angular_distance", 1.2);
	add_child(sun);

	Ref<ProceduralSkyMaterial> sky_mat; sky_mat.instantiate();
	sky_mat->set("sky_top_color", Color(0.29, 0.42, 0.62));
	sky_mat->set("sky_horizon_color", Color(0.86, 0.82, 0.72));
	sky_mat->set("ground_horizon_color", Color(0.78, 0.72, 0.6));
	sky_mat->set("ground_bottom_color", Color(0.32, 0.28, 0.22));
	sky_mat->set("sun_angle_max", 6.0);
	sky_mat->set("sky_energy_multiplier", 1.1);
	Ref<Sky> sky; sky.instantiate();
	sky->set("sky_material", sky_mat);

	Ref<Environment> env; env.instantiate();
	env->set("background_mode", Environment::BG_SKY);
	env->set("sky", sky);
	env->set("ambient_light_source", Environment::AMBIENT_SOURCE_SKY);
	env->set("ambient_light_energy", 1.0);
	env->set("tonemap_mode", Environment::TONE_MAPPER_ACES);
	env->set("tonemap_white", 6.0);
	env->set("ssao_enabled", true);
	env->set("ssao_intensity", 2.0);
	env->set("ssil_enabled", true);
	env->set("glow_enabled", true);
	env->set("glow_intensity", 0.5);
	env->set("glow_bloom", 0.15);
	env->set("glow_hdr_threshold", 1.1);
	env->set("fog_enabled", true);
	env->set("fog_light_color", Color(0.82, 0.78, 0.68));
	env->set("fog_density", 0.006);
	env->set("adjustment_enabled", true);
	env->set("adjustment_contrast", 1.06);
	env->set("adjustment_saturation", 1.1);

	WorldEnvironment *we = memnew(WorldEnvironment);
	we->set_environment(env);
	add_child(we);
}

// --------------------------------------------------------------- materials
Ref<StandardMaterial3D> Game::mat_ground(const Color &dark, const Color &light, float uv, float freq, float nfreq) {
	Ref<StandardMaterial3D> m; m.instantiate();
	Ref<FastNoiseLite> n; n.instantiate();
	n->set("frequency", freq); n->set("fractal_octaves", 5);
	Ref<NoiseTexture2D> at; at.instantiate();
	at->set("noise", n); at->set("width", 512); at->set("height", 512); at->set("seamless", true);
	Ref<Gradient> g; g.instantiate();
	PackedFloat32Array offs; offs.push_back(0.0); offs.push_back(1.0);
	PackedColorArray cols; cols.push_back(dark); cols.push_back(light);
	g->set_offsets(offs); g->set_colors(cols);
	at->set("color_ramp", g);

	Ref<FastNoiseLite> nn; nn.instantiate();
	nn->set("frequency", nfreq); nn->set("fractal_octaves", 4);
	Ref<NoiseTexture2D> nt; nt.instantiate();
	nt->set("noise", nn); nt->set("width", 256); nt->set("height", 256);
	nt->set("seamless", true); nt->set("as_normal_map", true); nt->set("bump_strength", 1.4);

	m->set("albedo_texture", at);
	m->set("normal_enabled", true);
	m->set("normal_texture", nt);
	m->set("normal_scale", 0.7);
	m->set("roughness", 0.95);
	m->set("uv1_scale", Vector3(uv, uv, 1));
	return m;
}

Ref<StandardMaterial3D> Game::mat_solid(const Color &c, float rough, float metal, float nfreq, float uv) {
	Ref<StandardMaterial3D> m; m.instantiate();
	m->set("albedo_color", c);
	m->set("roughness", rough);
	m->set("metallic", metal);
	if (nfreq > 0.0f) {
		Ref<FastNoiseLite> nn; nn.instantiate();
		nn->set("frequency", nfreq); nn->set("fractal_octaves", 3);
		Ref<NoiseTexture2D> nt; nt.instantiate();
		nt->set("noise", nn); nt->set("width", 256); nt->set("height", 256);
		nt->set("seamless", true); nt->set("as_normal_map", true); nt->set("bump_strength", 1.0);
		m->set("normal_enabled", true);
		m->set("normal_texture", nt);
		m->set("normal_scale", 0.4);
		m->set("uv1_scale", Vector3(uv, uv, 1));
	}
	return m;
}

Ref<StandardMaterial3D> Game::mat_glass() {
	Ref<StandardMaterial3D> m; m.instantiate();
	m->set("albedo_color", Color(0.11, 0.15, 0.2));
	m->set("metallic", 0.4);
	m->set("roughness", 0.08);
	m->set("emission_enabled", true);
	m->set("emission", Color(0.06, 0.11, 0.16));
	m->set("emission_energy_multiplier", 0.6);
	return m;
}

Ref<StandardMaterial3D> Game::mat_emissive(const Color &c, float energy) {
	Ref<StandardMaterial3D> m; m.instantiate();
	m->set("albedo_color", Color(0.04, 0.05, 0.06));
	m->set("emission_enabled", true);
	m->set("emission", c);
	m->set("emission_energy_multiplier", energy);
	return m;
}

// --------------------------------------------------------------- geometry
Node3D *Game::add_box(const Vector3 &size, const Vector3 &pos, const Ref<Material> &mat, bool collide, float rot_y) {
	Ref<BoxMesh> mesh; mesh.instantiate(); mesh->set_size(size);
	MeshInstance3D *mi = memnew(MeshInstance3D);
	mi->set_mesh(mesh);
	mi->set_material_override(mat);
	if (collide) {
		StaticBody3D *body = memnew(StaticBody3D);
		body->set_collision_layer(1 << L_WORLD);
		body->set_collision_mask(0);
		body->set_position(pos);
		body->rotate_y(rot_y);
		Ref<BoxShape3D> shape; shape.instantiate(); shape->set_size(size);
		CollisionShape3D *col = memnew(CollisionShape3D); col->set_shape(shape);
		body->add_child(col);
		body->add_child(mi);
		add_child(body);
		return body;
	}
	mi->set_position(pos);
	mi->rotate_y(rot_y);
	add_child(mi);
	return mi;
}

void Game::build_level() {
	Ref<StandardMaterial3D> sand = mat_ground(Color(0.42, 0.36, 0.24), Color(0.62, 0.55, 0.38), 40, 0.6f, 3.0f);
	Ref<StandardMaterial3D> concrete = mat_ground(Color(0.32, 0.31, 0.29), Color(0.55, 0.53, 0.5), 10, 0.4f, 2.0f);
	Ref<StandardMaterial3D> steel = mat_solid(Color(0.3, 0.32, 0.35), 0.5, 0.9, 1.2f, 3);
	Ref<StandardMaterial3D> body = mat_ground(Color(0.34, 0.33, 0.3), Color(0.6, 0.58, 0.54), 3, 0.5f, 1.5f);

	add_box(Vector3(400, 1, 400), Vector3(0, -0.5, 0), sand);
	add_box(Vector3(80, 0.1, 80), Vector3(0, 0.02, 0), concrete, false);

	double ext = 92.0, wall_h = 8.0;
	add_box(Vector3(ext * 2, wall_h, 1.5), Vector3(0, wall_h / 2, -ext), concrete);
	add_box(Vector3(ext * 2, wall_h, 1.5), Vector3(0, wall_h / 2, ext), concrete);
	add_box(Vector3(1.5, wall_h, ext * 2), Vector3(-ext, wall_h / 2, 0), concrete);
	add_box(Vector3(1.5, wall_h, ext * 2), Vector3(ext, wall_h / 2, 0), concrete);
	for (int i = -88; i <= 88; i += 12) {
		add_box(Vector3(1.2, wall_h + 0.6, 2.2), Vector3(i, (wall_h + 0.6) / 2, -ext), body, false);
		add_box(Vector3(1.2, wall_h + 0.6, 2.2), Vector3(i, (wall_h + 0.6) / 2, ext), body, false);
		add_box(Vector3(2.2, wall_h + 0.6, 1.2), Vector3(-ext, (wall_h + 0.6) / 2, i), body, false);
		add_box(Vector3(2.2, wall_h + 0.6, 1.2), Vector3(ext, (wall_h + 0.6) / 2, i), body, false);
	}
	Vector2 corners[4] = { Vector2(-ext, -ext), Vector2(ext, -ext), Vector2(ext, ext), Vector2(-ext, ext) };
	for (int i = 0; i < 4; i++)
		add_box(Vector3(4, wall_h + 5, 4), Vector3(corners[i].x, (wall_h + 5) / 2, corners[i].y), concrete);

	building(Vector3(-52, 0, -40), 24, 14, 18, body, steel);
	building(Vector3(50, 0, -46), 20, 10, 22, body, steel);
	building(Vector3(58, 0, 42), 28, 16, 20, body, steel);
	building(Vector3(-56, 0, 46), 22, 12, 16, body, steel);
	tower(Vector3(0, 0, 0), body, steel);

	Color cont_cols[4] = { Color(0.46, 0.34, 0.26), Color(0.36, 0.46, 0.5), Color(0.52, 0.47, 0.34), Color(0.46, 0.28, 0.26) };
	struct CL { Vector3 p; double r; };
	CL layout[10] = {
		{ Vector3(-20, 0, -18), 0 }, { Vector3(-20, 0, -12.5), 0 }, { Vector3(-14.6, 0, -15), PI / 2 },
		{ Vector3(22, 0, 15), 0 }, { Vector3(27.5, 0, 15), 0 }, { Vector3(24.7, 0, 20.4), PI / 2 },
		{ Vector3(-26, 0, 22), PI / 6 }, { Vector3(30, 0, -22), -PI / 8 },
		{ Vector3(8, 0, -30), 0 }, { Vector3(-8, 0, 30), PI / 2 },
	};
	for (int i = 0; i < 10; i++) {
		Ref<StandardMaterial3D> cm = mat_solid(cont_cols[i % 4], 0.55, 0.6, 4.0f, 1.0f);
		add_box(Vector3(6.06, 2.59, 2.44), layout[i].p + Vector3(0, 1.295, 0), cm, true, layout[i].r);
	}
	add_box(Vector3(6.06, 2.59, 2.44), Vector3(-20, 2.59 + 1.295, -18), mat_solid(cont_cols[1], 0.55, 0.6, 4.0f, 1.0f));

	Ref<StandardMaterial3D> bag = mat_solid(Color(0.6, 0.54, 0.38), 0.96, 0.0, 6.0f, 1.0f);
	sandbags(Vector3(-6, 0, -8), 0, 6, bag);
	sandbags(Vector3(10, 0, 6), PI / 2, 5, bag);
	sandbags(Vector3(-14, 0, 10), -PI / 5, 4, bag);

	Ref<StandardMaterial3D> barrel_mat = mat_solid(Color(0.42, 0.26, 0.2), 0.5, 0.7, 2.0f, 2.0f);
	Vector2 barrels[4] = { Vector2(-38, -8), Vector2(-36, -9), Vector2(42, 24), Vector2(12, 34) };
	for (int i = 0; i < 4; i++) barrel(Vector3(barrels[i].x, 0, barrels[i].y), barrel_mat);

	Ref<StandardMaterial3D> crate = mat_solid(Color(0.44, 0.38, 0.28), 0.7, 0.15, 3.0f, 1.0f);
	Vector3 crates[6] = { Vector3(15, 0.7, -8), Vector3(17, 0.7, -6), Vector3(16, 1.4, -7),
		Vector3(-32, 0.7, 4), Vector3(4, 0.7, 18), Vector3(36, 0.7, 8) };
	for (int i = 0; i < 6; i++)
		add_box(Vector3(1.4, 1.4, 1.4), crates[i], crate, true, UtilityFunctions::randf() * 0.4);

	Ref<StandardMaterial3D> rock = mat_solid(Color(0.34, 0.31, 0.26), 0.9, 0.0, 4.0f, 1.0f);
	for (int i = 0; i < 45; i++) {
		double rx = UtilityFunctions::randf_range(-85, 85);
		double rz = UtilityFunctions::randf_range(-85, 85);
		if (Vector2(rx, rz).length() < 10) continue;
		double s = UtilityFunctions::randf_range(0.3, 1.0);
		add_box(Vector3(s * UtilityFunctions::randf_range(0.8, 1.4), s * 0.6, s * UtilityFunctions::randf_range(0.8, 1.4)),
				Vector3(rx, s * 0.3, rz), rock, false, UtilityFunctions::randf() * PI);
	}

	spawn_points.push_back(Vector3(-70, 0, -70)); spawn_points.push_back(Vector3(70, 0, -70));
	spawn_points.push_back(Vector3(70, 0, 70)); spawn_points.push_back(Vector3(-70, 0, 70));
	spawn_points.push_back(Vector3(0, 0, -80)); spawn_points.push_back(Vector3(0, 0, 80));
	spawn_points.push_back(Vector3(-80, 0, 0)); spawn_points.push_back(Vector3(80, 0, 0));
}

void Game::building(const Vector3 &base, float w, float d, float h, const Ref<Material> &body, const Ref<Material> &trim) {
	add_box(Vector3(w, h, d), base + Vector3(0, h / 2, 0), body);
	add_box(Vector3(w * 0.55, h * 0.32, d * 0.55), base + Vector3(-w * 0.14, h + h * 0.16, -d * 0.12), body);
	add_box(Vector3(w + 0.5, 0.7, d + 0.5), base + Vector3(0, 0.35, 0), trim, false);
	add_box(Vector3(w + 0.4, 0.55, d + 0.4), base + Vector3(0, h + 0.28, 0), trim, false);
	Ref<StandardMaterial3D> glass = mat_glass();
	Ref<StandardMaterial3D> lit = mat_emissive(Color(1.0, 0.8, 0.5), 1.2);
	int rows = (int)MAX(1.0f, (h - 3) / 3.2f);
	int cols = (int)MAX(1.0f, (w - 1.5f) / 2.6f);
	int faces[2] = { 1, -1 };
	for (int f = 0; f < 2; f++)
		for (int r = 0; r < rows; r++)
			for (int c = 0; c < cols; c++) {
				double gx = base.x + (c - (cols - 1) / 2.0) * 2.6;
				double gy = 2.6 + r * 3.2;
				double gz = base.z + faces[f] * (d / 2 + 0.05);
				Ref<Material> gm = (UtilityFunctions::randf() < 0.28) ? (Ref<Material>)lit : (Ref<Material>)glass;
				add_box(Vector3(1.3, 1.5, 0.15), Vector3(gx, gy, gz), gm, false);
			}
	add_box(Vector3(2.0, 2.9, 0.15), base + Vector3(0, 1.5, d / 2 + 0.08), mat_emissive(Color(1.0, 0.81, 0.54), 1.1), false);
}

void Game::tower(const Vector3 &base, const Ref<Material> &body, const Ref<Material> &steel) {
	add_box(Vector3(8, 14, 8), base + Vector3(0, 7, 0), body);
	add_box(Vector3(12, 1, 12), base + Vector3(0, 14.5, 0), steel);
	add_box(Vector3(12.4, 0.4, 12.4), base + Vector3(0, 13.9, 0), body, false);
	double dzs[2] = { 6, -6 };
	for (int i = 0; i < 2; i++) {
		add_box(Vector3(12, 1.0, 0.12), base + Vector3(0, 15.6, dzs[i]), steel, false);
		add_box(Vector3(0.12, 1.0, 12), base + Vector3(dzs[i], 15.6, 0), steel, false);
	}
	add_box(Vector3(0.3, 8, 0.3), base + Vector3(4, 19, 4), steel, false);
	add_box(Vector3(0.3, 0.3, 0.3), base + Vector3(4, 23.1, 4), mat_emissive(Color(1, 0.23, 0.3), 3.0), false);
}

void Game::sandbags(const Vector3 &pos, float rot, int count, const Ref<Material> &mat) {
	StaticBody3D *group = memnew(StaticBody3D);
	group->set_collision_layer(1 << L_WORLD);
	group->set_collision_mask(0);
	group->set_position(pos);
	group->rotate_y(rot);
	add_child(group);
	CollisionShape3D *col = memnew(CollisionShape3D);
	Ref<BoxShape3D> cs; cs.instantiate();
	cs->set_size(Vector3(count * 0.72, 1.0, 0.6));
	col->set_shape(cs);
	col->set_position(Vector3(0, 0.5, 0));
	group->add_child(col);
	for (int row = 0; row < 3; row++) {
		double y = 0.16 + row * 0.3;
		int n = count - row;
		for (int i = 0; i < n; i++) {
			Ref<BoxMesh> mesh; mesh.instantiate();
			mesh->set_size(Vector3(UtilityFunctions::randf_range(0.62, 0.72), 0.28, 0.42));
			MeshInstance3D *mi = memnew(MeshInstance3D);
			mi->set_mesh(mesh);
			mi->set_material_override(mat);
			mi->set_position(Vector3((i - n / 2.0) * 0.72 + (row % 2) * 0.36, y, UtilityFunctions::randf_range(-0.05, 0.05)));
			mi->rotate_y(UtilityFunctions::randf_range(-0.1, 0.1));
			group->add_child(mi);
		}
	}
}

void Game::barrel(const Vector3 &pos, const Ref<Material> &mat) {
	Ref<CylinderMesh> mesh; mesh.instantiate();
	mesh->set_top_radius(0.5); mesh->set_bottom_radius(0.5); mesh->set_height(1.5);
	StaticBody3D *body = memnew(StaticBody3D);
	body->set_collision_layer(1 << L_WORLD);
	body->set_collision_mask(0);
	body->set_position(pos + Vector3(0, 0.75, 0));
	Ref<CylinderShape3D> shape; shape.instantiate();
	shape->set_radius(0.5); shape->set_height(1.5);
	CollisionShape3D *col = memnew(CollisionShape3D); col->set_shape(shape);
	MeshInstance3D *mi = memnew(MeshInstance3D); mi->set_mesh(mesh); mi->set_material_override(mat);
	body->add_child(col);
	body->add_child(mi);
	add_child(body);
}

// --------------------------------------------------------------- player
void Game::spawn_player() {
	player = memnew(Player);
	player->set_collision_layer(1 << L_PLAYER);
	player->set_collision_mask(1 << L_WORLD);
	player->set_position(Vector3(0, 2, 30));
	player->game = this;
	add_child(player);
}

// --------------------------------------------------------------- HUD
Label *Game::mk_label(Node *parent, const String &text, int size, const Color &color) {
	Label *l = memnew(Label);
	l->set_text(text);
	l->add_theme_font_size_override("font_size", size);
	l->add_theme_color_override("font_color", color);
	l->add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85));
	l->add_theme_constant_override("outline_size", 5);
	parent->add_child(l);
	return l;
}

void Game::anchor(Control *c, float l, float t, float r, float b) {
	c->set_anchor(SIDE_LEFT, l);
	c->set_anchor(SIDE_TOP, t);
	c->set_anchor(SIDE_RIGHT, r);
	c->set_anchor(SIDE_BOTTOM, b);
}

void Game::build_hud() {
	CanvasLayer *layer = memnew(CanvasLayer);
	add_child(layer);
	Color dim(0.55, 0.6, 0.65), ink(0.87, 0.91, 0.93);

	hud_hostiles = mk_label(layer, "SECTOR - 0 HOSTILES", 14, dim);
	hud_hostiles->set_position(Vector2(34, 24));
	hud_score = mk_label(layer, "0", 26, ink);
	hud_score->set_position(Vector2(34, 42));
	hud_wave = mk_label(layer, "WAVE 1", 14, Color(1.0, 0.69, 0.13));
	hud_wave->set_position(Vector2(34, 78));

	Label *vlabel = mk_label(layer, "VITALS", 13, dim);
	anchor(vlabel, 0, 1, 0, 1); vlabel->set_offset(SIDE_LEFT, 34); vlabel->set_offset(SIDE_TOP, -96);
	hud_health = mk_label(layer, "100", 40, Color(0.2, 0.88, 0.75));
	anchor(hud_health, 0, 1, 0, 1); hud_health->set_offset(SIDE_LEFT, 34); hud_health->set_offset(SIDE_TOP, -80);

	hud_weapon = mk_label(layer, "M4-X CARBINE", 15, dim);
	anchor(hud_weapon, 1, 1, 1, 1); hud_weapon->set_offset(SIDE_LEFT, -300);
	hud_weapon->set_offset(SIDE_RIGHT, -34); hud_weapon->set_offset(SIDE_TOP, -96);
	hud_weapon->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_RIGHT);
	hud_ammo = mk_label(layer, "30 / 210", 40, ink);
	anchor(hud_ammo, 1, 1, 1, 1); hud_ammo->set_offset(SIDE_LEFT, -300);
	hud_ammo->set_offset(SIDE_RIGHT, -34); hud_ammo->set_offset(SIDE_TOP, -80);
	hud_ammo->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_RIGHT);
	hud_reload = mk_label(layer, "", 14, Color(1.0, 0.69, 0.13));
	anchor(hud_reload, 1, 1, 1, 1); hud_reload->set_offset(SIDE_LEFT, -300);
	hud_reload->set_offset(SIDE_RIGHT, -34); hud_reload->set_offset(SIDE_TOP, -30);
	hud_reload->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_RIGHT);

	hud_announce = mk_label(layer, "", 44, ink);
	anchor(hud_announce, 0, 0.32f, 1, 0.32f);
	hud_announce->set_horizontal_alignment(HORIZONTAL_ALIGNMENT_CENTER);

	crosshair = memnew(Control);
	anchor(crosshair, 0.5f, 0.5f, 0.5f, 0.5f);
	layer->add_child(crosshair);
	Rect2 lines[4] = { Rect2(-1, -9, 2, 6), Rect2(-1, 3, 2, 6), Rect2(-9, -1, 6, 2), Rect2(3, -1, 6, 2) };
	for (int i = 0; i < 4; i++) {
		ColorRect *cr = memnew(ColorRect);
		cr->set_color(Color(0.9, 0.96, 0.94, 0.9));
		cr->set_position(lines[i].position);
		cr->set_size(lines[i].size);
		crosshair->add_child(cr);
	}
}

void Game::announce(const String &text, double dur) {
	if (hud_announce) hud_announce->set_text(text);
	announce_timer = dur;
}

// --------------------------------------------------------------- waves
void Game::start_next_wave() {
	wave += 1;
	enemies_to_spawn = MIN(4 + wave * 2, 18);
	state = "active";
	spawn_timer = 0.0;
	hud_wave->set_text(String("WAVE ") + String::num_int64(wave));
	announce(String("WAVE ") + String::num_int64(wave));
}

void Game::spawn_enemy() {
	Enemy *e = memnew(Enemy);
	e->set_collision_layer(1 << L_ENEMY);
	e->set_collision_mask(1 << L_WORLD);
	Vector3 sp = spawn_points[UtilityFunctions::randi() % spawn_points.size()];
	e->set_position(sp + Vector3(UtilityFunctions::randf_range(-6, 6), 2, UtilityFunctions::randf_range(-6, 6)));
	e->game = this;
	e->target = player;
	e->max_health = 100 + wave * 8;
	e->damage = 7.0 + wave * 0.6;
	add_child(e);
	e->add_to_group("enemies");
	enemies.push_back(e);
}

void Game::on_enemy_died(Node *e, bool headshot) {
	enemies.erase((Enemy *)e);
	score += headshot ? 150 : 100;
	hud_score->set_text(String::num_int64(score));
	if (headshot) announce("HEADSHOT", 0.9);
}

void Game::register_spark(Node3D *light, double ttl) {
	Spark s; s.node = light; s.ttl = ttl; s.max_ttl = ttl;
	sparks.push_back(s);
}

void Game::_process(double delta) {
	if (state == "intermission") {
		spawn_timer -= delta;
		if (spawn_timer <= 0.0) start_next_wave();
	} else if (state == "active") {
		if (enemies_to_spawn > 0) {
			spawn_timer -= delta;
			if (spawn_timer <= 0.0) {
				spawn_enemy();
				enemies_to_spawn -= 1;
				spawn_timer = UtilityFunctions::randf_range(0.6, 1.3);
			}
		} else if (enemies.is_empty()) {
			state = "intermission";
			spawn_timer = intermission;
			announce("SECTOR CLEAR");
			if (player) player->heal(25);
		}
	}

	if (player) {
		hud_health->set_text(String::num_int64((int64_t)Math::ceil(player->get_health())));
		hud_health->add_theme_color_override("font_color",
				player->get_health() < 30 ? Color(1, 0.23, 0.3) : Color(0.2, 0.88, 0.75));
		hud_ammo->set_text(String::num_int64(player->get_mag()) + String(" / ") + String::num_int64(player->get_reserve()));
		hud_weapon->set_text(player->get_weapon_name());
		hud_reload->set_text(player->is_reloading() ? String("RELOADING...") : String(""));
	}
	hud_hostiles->set_text(String("SECTOR - ") + String::num_int64(enemies.size()) + String(" HOSTILES"));

	// timed FX (impact light flashes)
	Spark *sp = sparks.ptrw();
	for (int i = sparks.size() - 1; i >= 0; i--) {
		sp[i].ttl -= delta;
		if (sp[i].ttl <= 0.0) {
			if (sp[i].node) sp[i].node->queue_free();
			sparks.remove_at(i);
			sp = sparks.ptrw();
		} else if (sp[i].node) {
			sp[i].node->set("light_energy", 2.0 * (sp[i].ttl / sp[i].max_ttl));
		}
	}

	if (announce_timer > 0.0) {
		announce_timer -= delta;
		if (announce_timer <= 0.0 && hud_announce) hud_announce->set_text("");
	}
}
