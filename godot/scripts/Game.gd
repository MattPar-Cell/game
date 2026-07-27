extends Node3D
## OVERRIDE — Godot 4 port. Top-level orchestrator: registers input, builds
## the environment + level geometry procedurally, spawns the player and enemy
## waves, and drives the HUD. Mirrors the Three.js version's design but leans
## on Godot's native renderer (Vulkan, SSAO/SSIL, glow, ACES, soft shadows).

const Player := preload("res://scripts/Player.gd")
const Enemy := preload("res://scripts/Enemy.gd")

# collision layers (1-indexed bit positions): 1 world, 2 player, 3 enemy
const L_WORLD := 1
const L_PLAYER := 2
const L_ENEMY := 3

var player: CharacterBody3D
var enemies: Array = []
var spawn_points: Array = []

var wave := 0
var enemies_to_spawn := 0
var spawn_timer := 0.0
var intermission := 2.0
var state := "intermission"
var score := 0

# HUD refs
var hud_health: Label
var hud_ammo: Label
var hud_weapon: Label
var hud_wave: Label
var hud_score: Label
var hud_hostiles: Label
var hud_announce: Label
var hud_reload: Label
var crosshair: Control
var announce_timer := 0.0

func _ready() -> void:
	randomize()
	_register_input()
	_build_environment()
	_build_level()
	_spawn_player()
	_build_hud()
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

# --------------------------------------------------------------- input
func _register_input() -> void:
	var binds := {
		"move_forward": KEY_W, "move_back": KEY_S,
		"move_left": KEY_A, "move_right": KEY_D,
		"jump": KEY_SPACE, "sprint": KEY_SHIFT, "crouch": KEY_CTRL,
		"reload": KEY_R, "lean_left": KEY_Q, "lean_right": KEY_E,
		"weapon_1": KEY_1, "weapon_2": KEY_2, "weapon_3": KEY_3,
	}
	for action in binds:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
			var ev := InputEventKey.new()
			ev.physical_keycode = binds[action]
			InputMap.action_add_event(action, ev)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
		Input.mouse_mode = (Input.MOUSE_MODE_VISIBLE
			if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
			else Input.MOUSE_MODE_CAPTURED)
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

# --------------------------------------------------------------- environment
func _build_environment() -> void:
	# Sun (key light) + soft shadows
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, 42, 0)
	sun.light_color = Color(1.0, 0.94, 0.82)
	sun.light_energy = 1.6
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 200.0
	sun.light_angular_distance = 1.2  # soft penumbra
	add_child(sun)

	# Sky + image-based lighting
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.29, 0.42, 0.62)
	sky_mat.sky_horizon_color = Color(0.86, 0.82, 0.72)
	sky_mat.ground_horizon_color = Color(0.78, 0.72, 0.6)
	sky_mat.ground_bottom_color = Color(0.32, 0.28, 0.22)
	sky_mat.sun_angle_max = 6.0
	sky_mat.sky_energy_multiplier = 1.1
	var sky := Sky.new()
	sky.sky_material = sky_mat

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 1.0
	env.tonemap_mode = Environment.TONE_MAPPER_ACES
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.ssao_enabled = true
	env.ssao_radius = 1.2
	env.ssao_intensity = 2.0
	env.ssil_enabled = true
	env.glow_enabled = true
	env.glow_intensity = 0.5
	env.glow_bloom = 0.15
	env.glow_hdr_threshold = 1.1
	env.fog_enabled = true
	env.fog_light_color = Color(0.82, 0.78, 0.68)
	env.fog_density = 0.006
	env.fog_sun_scatter = 0.3
	env.adjustment_enabled = true
	env.adjustment_brightness = 1.02
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.1

	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

# --------------------------------------------------------------- materials
func _gradient(a: Color, b: Color) -> Gradient:
	var g := Gradient.new()
	g.set_color(0, a)
	g.set_color(1, b)
	return g

func _noise_normal(freq: float, strength: float) -> NoiseTexture2D:
	var n := FastNoiseLite.new()
	n.frequency = freq
	n.fractal_octaves = 4
	var t := NoiseTexture2D.new()
	t.noise = n
	t.width = 256
	t.height = 256
	t.as_normal_map = true
	t.bump_strength = strength
	t.seamless = true
	return t

func mat_ground(dark: Color, light: Color, uv: float, freq: float, normal_freq: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	var n := FastNoiseLite.new()
	n.frequency = freq
	n.fractal_octaves = 5
	var at := NoiseTexture2D.new()
	at.noise = n
	at.width = 512
	at.height = 512
	at.seamless = true
	at.color_ramp = _gradient(dark, light)
	m.albedo_texture = at
	m.normal_enabled = true
	m.normal_texture = _noise_normal(normal_freq, 1.4)
	m.normal_scale = 0.7
	m.roughness = 0.95
	m.uv1_scale = Vector3(uv, uv, 1)
	m.ao_enabled = false
	return m

func mat_solid(color: Color, rough: float, metal: float, normal_freq := 0.0, uv := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	if normal_freq > 0.0:
		m.normal_enabled = true
		m.normal_texture = _noise_normal(normal_freq, 1.0)
		m.normal_scale = 0.4
		m.uv1_scale = Vector3(uv, uv, 1)
	return m

func mat_glass() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.11, 0.15, 0.2)
	m.metallic = 0.4
	m.roughness = 0.08
	m.emission_enabled = true
	m.emission = Color(0.06, 0.11, 0.16)
	m.emission_energy_multiplier = 0.6
	return m

func mat_emissive(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.04, 0.05, 0.06)
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	return m

# --------------------------------------------------------------- geometry
func add_box(size: Vector3, pos: Vector3, mat: Material, collide := true, rot_y := 0.0) -> Node3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	if collide:
		var body := StaticBody3D.new()
		body.collision_layer = 1 << (L_WORLD - 1)
		body.collision_mask = 0
		body.position = pos
		body.rotation.y = rot_y
		var col := CollisionShape3D.new()
		var shape := BoxShape3D.new()
		shape.size = size
		col.shape = shape
		body.add_child(col)
		body.add_child(mi)
		add_child(body)
		return body
	else:
		mi.position = pos
		mi.rotation.y = rot_y
		add_child(mi)
		return mi

func _build_level() -> void:
	var sand := mat_ground(Color(0.42, 0.36, 0.24), Color(0.62, 0.55, 0.38), 40.0, 0.6, 3.0)
	var concrete := mat_ground(Color(0.32, 0.31, 0.29), Color(0.55, 0.53, 0.5), 10.0, 0.4, 2.0)
	var steel := mat_solid(Color(0.3, 0.32, 0.35), 0.5, 0.9, 1.2, 3)
	var body_mat := mat_ground(Color(0.34, 0.33, 0.3), Color(0.6, 0.58, 0.54), 3.0, 0.5, 1.5)

	# ground + paved pad
	add_box(Vector3(400, 1, 400), Vector3(0, -0.5, 0), sand)
	add_box(Vector3(80, 0.1, 80), Vector3(0, 0.02, 0), concrete, false)

	# perimeter wall + pillars + corner towers
	var ext := 92.0
	var wall_h := 8.0
	var wall_specs := [
		[Vector3(ext * 2, wall_h, 1.5), Vector3(0, wall_h / 2, -ext)],
		[Vector3(ext * 2, wall_h, 1.5), Vector3(0, wall_h / 2, ext)],
		[Vector3(1.5, wall_h, ext * 2), Vector3(-ext, wall_h / 2, 0)],
		[Vector3(1.5, wall_h, ext * 2), Vector3(ext, wall_h / 2, 0)],
	]
	for s in wall_specs:
		add_box(s[0], s[1], concrete)
	for i in range(-88, 89, 12):
		add_box(Vector3(1.2, wall_h + 0.6, 2.2), Vector3(i, (wall_h + 0.6) / 2, -ext), body_mat, false)
		add_box(Vector3(1.2, wall_h + 0.6, 2.2), Vector3(i, (wall_h + 0.6) / 2, ext), body_mat, false)
		add_box(Vector3(2.2, wall_h + 0.6, 1.2), Vector3(-ext, (wall_h + 0.6) / 2, i), body_mat, false)
		add_box(Vector3(2.2, wall_h + 0.6, 1.2), Vector3(ext, (wall_h + 0.6) / 2, i), body_mat, false)
	for c in [Vector2(-ext, -ext), Vector2(ext, -ext), Vector2(ext, ext), Vector2(-ext, ext)]:
		add_box(Vector3(4, wall_h + 5, 4), Vector3(c.x, (wall_h + 5) / 2, c.y), concrete)

	# buildings
	_building(Vector3(-52, 0, -40), 24, 14, 18, body_mat, steel)
	_building(Vector3(50, 0, -46), 20, 10, 22, body_mat, steel)
	_building(Vector3(58, 0, 42), 28, 16, 20, body_mat, steel)
	_building(Vector3(-56, 0, 46), 22, 12, 16, body_mat, steel)

	# control tower
	_tower(Vector3(0, 0, 0), body_mat, steel)

	# containers
	var cont_cols := [Color(0.46, 0.34, 0.26), Color(0.36, 0.46, 0.5), Color(0.52, 0.47, 0.34), Color(0.46, 0.28, 0.26)]
	var layout := [
		[Vector3(-20, 0, -18), 0.0], [Vector3(-20, 0, -12.5), 0.0], [Vector3(-14.6, 0, -15), PI / 2],
		[Vector3(22, 0, 15), 0.0], [Vector3(27.5, 0, 15), 0.0], [Vector3(24.7, 0, 20.4), PI / 2],
		[Vector3(-26, 0, 22), PI / 6], [Vector3(30, 0, -22), -PI / 8],
		[Vector3(8, 0, -30), 0.0], [Vector3(-8, 0, 30), PI / 2],
	]
	for i in range(layout.size()):
		var col: Color = cont_cols[i % cont_cols.size()]
		var cm := mat_solid(col, 0.55, 0.6, 4.0, 1.0)
		var p: Vector3 = layout[i][0]
		add_box(Vector3(6.06, 2.59, 2.44), p + Vector3(0, 1.295, 0), cm, true, layout[i][1])
	# stacked perch
	add_box(Vector3(6.06, 2.59, 2.44), Vector3(-20, 2.59 + 1.295, -18), mat_solid(cont_cols[1], 0.55, 0.6, 4.0, 1.0))

	# sandbags
	var bag := mat_solid(Color(0.6, 0.54, 0.38), 0.96, 0.0, 6.0, 1.0)
	_sandbags(Vector3(-6, 0, -8), 0.0, 6, bag)
	_sandbags(Vector3(10, 0, 6), PI / 2, 5, bag)
	_sandbags(Vector3(-14, 0, 10), -PI / 5, 4, bag)

	# barrels + crates
	var barrel := mat_solid(Color(0.42, 0.26, 0.2), 0.5, 0.7, 2.0, 2.0)
	for b in [Vector2(-38, -8), Vector2(-36, -9), Vector2(42, 24), Vector2(12, 34)]:
		_barrel(Vector3(b.x, 0, b.y), barrel)
	var crate := mat_solid(Color(0.44, 0.38, 0.28), 0.7, 0.15, 3.0, 1.0)
	for c in [Vector3(15, 0.7, -8), Vector3(17, 0.7, -6), Vector3(16, 1.4, -7),
			Vector3(-32, 0.7, 4), Vector3(4, 0.7, 18), Vector3(36, 0.7, 8)]:
		add_box(Vector3(1.4, 1.4, 1.4), c, crate, true, randf() * 0.4)

	# scattered rock debris
	var rock := mat_solid(Color(0.34, 0.31, 0.26), 0.9, 0.0, 4.0, 1.0)
	for i in range(45):
		var rx := randf_range(-85, 85)
		var rz := randf_range(-85, 85)
		if Vector2(rx, rz).length() < 10:
			continue
		var s := randf_range(0.3, 1.0)
		add_box(Vector3(s * randf_range(0.8, 1.4), s * 0.6, s * randf_range(0.8, 1.4)),
			Vector3(rx, s * 0.3, rz), rock, false, randf() * PI)

	spawn_points = [
		Vector3(-70, 0, -70), Vector3(70, 0, -70), Vector3(70, 0, 70), Vector3(-70, 0, 70),
		Vector3(0, 0, -80), Vector3(0, 0, 80), Vector3(-80, 0, 0), Vector3(80, 0, 0),
	]

func _building(base: Vector3, w: float, d: float, h: float, body: Material, trim: Material) -> void:
	add_box(Vector3(w, h, d), base + Vector3(0, h / 2, 0), body)
	# setback roof mass
	add_box(Vector3(w * 0.55, h * 0.32, d * 0.55), base + Vector3(-w * 0.14, h + h * 0.16, -d * 0.12), body)
	# plinth + parapet
	add_box(Vector3(w + 0.5, 0.7, d + 0.5), base + Vector3(0, 0.35, 0), trim, false)
	add_box(Vector3(w + 0.4, 0.55, d + 0.4), base + Vector3(0, h + 0.28, 0), trim, false)
	# windows on the +z / -z faces
	var glass := mat_glass()
	var lit := mat_emissive(Color(1.0, 0.8, 0.5), 1.2)
	var rows := int(max(1, (h - 3) / 3.2))
	var cols := int(max(1, (w - 1.5) / 2.6))
	for face in [1, -1]:
		for r in range(rows):
			for c in range(cols):
				var gx := base.x + (c - (cols - 1) / 2.0) * 2.6
				var gy := 2.6 + r * 3.2
				var gz := base.z + face * (d / 2 + 0.05)
				var gm: Material = lit if randf() < 0.28 else glass
				add_box(Vector3(1.3, 1.5, 0.15), Vector3(gx, gy, gz), gm, false)
	# door glow
	add_box(Vector3(2.0, 2.9, 0.15), base + Vector3(0, 1.5, d / 2 + 0.08),
		mat_emissive(Color(1.0, 0.81, 0.54), 1.1), false)

func _tower(base: Vector3, body: Material, steel: Material) -> void:
	add_box(Vector3(8, 14, 8), base + Vector3(0, 7, 0), body)
	add_box(Vector3(12, 1, 12), base + Vector3(0, 14.5, 0), steel)
	add_box(Vector3(12.4, 0.4, 12.4), base + Vector3(0, 13.9, 0), body, false)
	# railings
	for dz in [6.0, -6.0]:
		add_box(Vector3(12, 1.0, 0.12), base + Vector3(0, 15.6, dz), steel, false)
	for dx in [6.0, -6.0]:
		add_box(Vector3(0.12, 1.0, 12), base + Vector3(dx, 15.6, 0), steel, false)
	# antenna + beacon
	add_box(Vector3(0.3, 8, 0.3), base + Vector3(4, 19, 4), steel, false)
	add_box(Vector3(0.3, 0.3, 0.3), base + Vector3(4, 23.1, 4), mat_emissive(Color(1, 0.23, 0.3), 3.0), false)

func _sandbags(pos: Vector3, rot: float, count: int, mat: Material) -> void:
	var group := StaticBody3D.new()
	group.collision_layer = 1 << (L_WORLD - 1)
	group.collision_mask = 0
	group.position = pos
	group.rotation.y = rot
	add_child(group)
	var box_col := CollisionShape3D.new()
	var cshape := BoxShape3D.new()
	cshape.size = Vector3(count * 0.72, 1.0, 0.6)
	box_col.shape = cshape
	box_col.position = Vector3(0, 0.5, 0)
	group.add_child(box_col)
	for row in range(3):
		var y := 0.16 + row * 0.3
		var n := count - row
		for i in range(n):
			var mesh := BoxMesh.new()
			mesh.size = Vector3(randf_range(0.62, 0.72), 0.28, 0.42)
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			mi.material_override = mat
			mi.position = Vector3((i - n / 2.0) * 0.72 + (row % 2) * 0.36, y, randf_range(-0.05, 0.05))
			mi.rotation.y = randf_range(-0.1, 0.1)
			group.add_child(mi)

func _barrel(pos: Vector3, mat: Material) -> void:
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.5
	mesh.bottom_radius = 0.5
	mesh.height = 1.5
	var body := StaticBody3D.new()
	body.collision_layer = 1 << (L_WORLD - 1)
	body.collision_mask = 0
	body.position = pos + Vector3(0, 0.75, 0)
	var col := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 0.5
	shape.height = 1.5
	col.shape = shape
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	body.add_child(col)
	body.add_child(mi)
	add_child(body)

# --------------------------------------------------------------- player
func _spawn_player() -> void:
	player = CharacterBody3D.new()
	player.set_script(Player)
	player.collision_layer = 1 << (L_PLAYER - 1)
	player.collision_mask = 1 << (L_WORLD - 1)
	player.position = Vector3(0, 2, 30)
	player.game = self
	add_child(player)

# --------------------------------------------------------------- HUD
func _build_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var dim := Color(0.55, 0.6, 0.65)
	var ink := Color(0.87, 0.91, 0.93)

	# top-left: objective / score / wave (anchored top-left, default anchors)
	hud_hostiles = _mk_label(layer, "SECTOR — 0 HOSTILES", 14, dim)
	hud_hostiles.offset_left = 34; hud_hostiles.offset_top = 24
	hud_score = _mk_label(layer, "0", 26, ink)
	hud_score.offset_left = 34; hud_score.offset_top = 42
	hud_wave = _mk_label(layer, "WAVE 1", 14, Color(1.0, 0.69, 0.13))
	hud_wave.offset_left = 34; hud_wave.offset_top = 78

	# bottom-left: vitals
	var vlabel := _mk_label(layer, "VITALS", 13, dim)
	_anchor(vlabel, 0, 1, 0, 1); vlabel.offset_left = 34; vlabel.offset_top = -96
	hud_health = _mk_label(layer, "100", 40, Color(0.2, 0.88, 0.75))
	_anchor(hud_health, 0, 1, 0, 1); hud_health.offset_left = 34; hud_health.offset_top = -80

	# bottom-right: weapon / ammo
	hud_weapon = _mk_label(layer, "M4-X CARBINE", 15, dim)
	_anchor(hud_weapon, 1, 1, 1, 1); hud_weapon.offset_left = -300; hud_weapon.offset_top = -96
	hud_weapon.offset_right = -34; hud_weapon.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud_ammo = _mk_label(layer, "30 / 210", 40, ink)
	_anchor(hud_ammo, 1, 1, 1, 1); hud_ammo.offset_left = -300; hud_ammo.offset_top = -80
	hud_ammo.offset_right = -34; hud_ammo.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hud_reload = _mk_label(layer, "", 14, Color(1.0, 0.69, 0.13))
	_anchor(hud_reload, 1, 1, 1, 1); hud_reload.offset_left = -300; hud_reload.offset_top = -30
	hud_reload.offset_right = -34; hud_reload.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT

	# center announcement
	hud_announce = _mk_label(layer, "", 44, ink)
	_anchor(hud_announce, 0, 0.32, 1, 0.32)
	hud_announce.offset_left = 0; hud_announce.offset_right = 0
	hud_announce.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER

	# crosshair (centered)
	crosshair = Control.new()
	_anchor(crosshair, 0.5, 0.5, 0.5, 0.5)
	layer.add_child(crosshair)
	for r in [Rect2(-1, -9, 2, 6), Rect2(-1, 3, 2, 6), Rect2(-9, -1, 6, 2), Rect2(3, -1, 6, 2)]:
		var line := ColorRect.new()
		line.color = Color(0.9, 0.96, 0.94, 0.9)
		line.position = r.position
		line.size = r.size
		crosshair.add_child(line)

func _mk_label(parent: Node, text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	l.add_theme_constant_override("outline_size", 5)
	parent.add_child(l)
	return l

func _anchor(c: Control, l: float, t: float, r: float, b: float) -> void:
	c.anchor_left = l; c.anchor_top = t; c.anchor_right = r; c.anchor_bottom = b

func announce(text: String, dur := 2.2) -> void:
	hud_announce.text = text
	announce_timer = dur

# --------------------------------------------------------------- waves
func start_next_wave() -> void:
	wave += 1
	enemies_to_spawn = min(4 + wave * 2, 18)
	state = "active"
	spawn_timer = 0.0
	hud_wave.text = "WAVE %d" % wave
	announce("WAVE %d" % wave)

func _spawn_enemy() -> void:
	var e := CharacterBody3D.new()
	e.set_script(Enemy)
	e.collision_layer = 1 << (L_ENEMY - 1)
	e.collision_mask = 1 << (L_WORLD - 1)
	var sp: Vector3 = spawn_points[randi() % spawn_points.size()]
	e.position = sp + Vector3(randf_range(-6, 6), 2, randf_range(-6, 6))
	e.game = self
	e.target = player
	e.max_health = 100 + wave * 8
	e.damage = 7.0 + wave * 0.6
	add_child(e)
	e.add_to_group("enemies")
	enemies.append(e)

func on_enemy_died(e: Node, headshot: bool) -> void:
	enemies.erase(e)
	score += 150 if headshot else 100
	hud_score.text = str(score)
	if headshot:
		announce("HEADSHOT", 0.9)

func _process(delta: float) -> void:
	# wave state machine
	if state == "intermission":
		spawn_timer -= delta
		if spawn_timer <= 0.0:
			start_next_wave()
	elif state == "active":
		if enemies_to_spawn > 0:
			spawn_timer -= delta
			if spawn_timer <= 0.0:
				_spawn_enemy()
				enemies_to_spawn -= 1
				spawn_timer = randf_range(0.6, 1.3)
		elif enemies.is_empty():
			state = "intermission"
			spawn_timer = intermission
			announce("SECTOR CLEAR")
			if is_instance_valid(player):
				player.heal(25)

	# HUD sync
	if is_instance_valid(player):
		hud_health.text = str(int(ceil(player.health)))
		hud_health.add_theme_color_override("font_color",
			Color(1, 0.23, 0.3) if player.health < 30 else Color(0.2, 0.88, 0.75))
		hud_ammo.text = "%d / %d" % [player.mag, player.reserve]
		hud_weapon.text = player.weapon_name
		hud_reload.text = "RELOADING…" if player.reloading else ""
	hud_hostiles.text = "SECTOR — %d HOSTILES" % enemies.size()

	if announce_timer > 0.0:
		announce_timer -= delta
		if announce_timer <= 0.0:
			hud_announce.text = ""
