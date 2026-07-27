extends CharacterBody3D
## First-person controller: acceleration-based movement (sprint/crouch/jump),
## mouse look with view-punch recoil, a procedurally-built weapon viewmodel,
## hitscan firing with spread/recoil/reload, and ADS. Built entirely in code
## so no scene files are needed.

var game: Node3D
var head: Node3D
var camera: Camera3D
var view_weapon: Node3D
var muzzle_flash: OmniLight3D
var flash_mesh: MeshInstance3D

# movement
var speed_walk := 5.4
var speed_sprint := 8.8
var speed_crouch := 2.8
var accel := 12.0
var jump_force := 6.2
var gravity := 20.0
var mouse_sens := 0.0025
var pitch := 0.0
var stand_height := 1.7
var crouch_height := 1.1
var _capsule: CapsuleShape3D
var aiming := false
var sprinting := false

# recoil / sway
var punch := Vector2.ZERO
var punch_vel := Vector2.ZERO
var bob_t := 0.0
var base_fov := 78.0
var flash_time := 0.0

# health
var health := 100.0
var max_health := 100.0

# weapons
var weapons := [
	{"name": "M4-X CARBINE", "rpm": 720, "dmg": 26.0, "mag": 30, "reserve": 210, "auto": true,
	 "spread": 0.012, "ads_spread": 0.0015, "recoil": 0.028, "ads_fov": 55.0, "reload": 2.1, "hs": 2.4, "range": 120.0},
	{"name": "VECTOR-9 SMG", "rpm": 1050, "dmg": 18.0, "mag": 40, "reserve": 280, "auto": true,
	 "spread": 0.02, "ads_spread": 0.004, "recoil": 0.019, "ads_fov": 62.0, "reload": 1.8, "hs": 2.0, "range": 70.0},
	{"name": "MK.II SIDEARM", "rpm": 360, "dmg": 34.0, "mag": 15, "reserve": 90, "auto": false,
	 "spread": 0.01, "ads_spread": 0.002, "recoil": 0.036, "ads_fov": 58.0, "reload": 1.5, "hs": 2.2, "range": 60.0},
]
var cur := 0
var mag := 30
var reserve := 210
var ammo := []          # per-weapon [mag, reserve]
var weapon_name := "M4-X CARBINE"
var fire_timer := 0.0
var reloading := false
var reload_timer := 0.0
var _left_was_down := false
var _spread_bloom := 0.0

func _ready() -> void:
	# collision capsule
	var col := CollisionShape3D.new()
	_capsule = CapsuleShape3D.new()
	_capsule.radius = 0.4
	_capsule.height = stand_height
	col.shape = _capsule
	col.position = Vector3(0, stand_height / 2, 0)
	add_child(col)

	head = Node3D.new()
	head.position = Vector3(0, stand_height, 0)
	add_child(head)

	camera = Camera3D.new()
	camera.fov = base_fov
	camera.current = true
	head.add_child(camera)

	_build_viewmodel()

	# init ammo store
	for w in weapons:
		ammo.append([w["mag"], w["reserve"]])
	_equip(0)

func _build_viewmodel() -> void:
	view_weapon = Node3D.new()
	view_weapon.position = Vector3(0.18, -0.2, -0.5)
	camera.add_child(view_weapon)

	var body := StandardMaterial3D.new()
	body.albedo_color = Color(0.09, 0.1, 0.12)
	body.roughness = 0.55
	body.metallic = 0.2
	var metal := StandardMaterial3D.new()
	metal.albedo_color = Color(0.16, 0.17, 0.19)
	metal.roughness = 0.34
	metal.metallic = 0.9

	_gun_part(Vector3(0.09, 0.11, 0.5), Vector3(0, 0, 0), metal)          # receiver
	_gun_part(Vector3(0.07, 0.03, 0.46), Vector3(0, 0.07, 0.02), body)    # rail
	_gun_part(Vector3(0.05, 0.05, 0.42), Vector3(0, 0.01, -0.42), metal)  # barrel
	_gun_part(Vector3(0.07, 0.07, 0.34), Vector3(0, 0.01, -0.28), body)   # handguard
	_gun_part(Vector3(0.06, 0.22, 0.1), Vector3(0, -0.15, 0.05), body)    # magazine
	_gun_part(Vector3(0.06, 0.16, 0.07), Vector3(0, -0.1, 0.2), body)     # grip
	_gun_part(Vector3(0.05, 0.09, 0.26), Vector3(0, 0.0, 0.4), body)      # stock
	_gun_part(Vector3(0.05, 0.06, 0.14), Vector3(0, 0.11, 0.04), metal)   # optic

	# reticle dot
	var dot := MeshInstance3D.new()
	var dm := SphereMesh.new()
	dm.radius = 0.006
	dm.height = 0.012
	dot.mesh = dm
	var de := StandardMaterial3D.new()
	de.albedo_color = Color(0.27, 1.0, 0.6)
	de.emission_enabled = true
	de.emission = Color(0.27, 1.0, 0.6)
	de.emission_energy_multiplier = 3.0
	dot.material_override = de
	dot.position = Vector3(0, 0.11, -0.03)
	view_weapon.add_child(dot)

	# muzzle flash light + quad
	muzzle_flash = OmniLight3D.new()
	muzzle_flash.light_color = Color(1.0, 0.79, 0.44)
	muzzle_flash.light_energy = 0.0
	muzzle_flash.omni_range = 12.0
	muzzle_flash.position = Vector3(0, 0.01, -0.68)
	view_weapon.add_child(muzzle_flash)

	flash_mesh = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(0.35, 0.35)
	flash_mesh.mesh = q
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(1.0, 0.9, 0.6)
	fm.emission_enabled = true
	fm.emission = Color(1.0, 0.85, 0.5)
	fm.emission_energy_multiplier = 6.0
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	flash_mesh.mesh.material = fm
	flash_mesh.position = Vector3(0, 0.01, -0.72)
	flash_mesh.visible = false
	view_weapon.add_child(flash_mesh)

func _gun_part(size: Vector3, pos: Vector3, mat: Material) -> void:
	var m := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	m.mesh = box
	m.material_override = mat
	m.position = pos
	view_weapon.add_child(m)

func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		rotate_y(-event.relative.x * mouse_sens)
		pitch = clamp(pitch - event.relative.y * mouse_sens, -1.5, 1.5)
		head.rotation.x = pitch

func _physics_process(delta: float) -> void:
	# --- movement input
	var input_dir := Vector3.ZERO
	if Input.is_action_pressed("move_forward"): input_dir.z -= 1
	if Input.is_action_pressed("move_back"): input_dir.z += 1
	if Input.is_action_pressed("move_left"): input_dir.x -= 1
	if Input.is_action_pressed("move_right"): input_dir.x += 1
	var moving := input_dir.length() > 0.01
	var dir := (transform.basis * input_dir).normalized()

	var crouching := Input.is_action_pressed("crouch")
	sprinting = Input.is_action_pressed("sprint") and Input.is_action_pressed("move_forward") and not crouching and not aiming
	var target_speed := speed_walk
	if crouching: target_speed = speed_crouch
	elif sprinting: target_speed = speed_sprint
	if aiming: target_speed *= 0.55

	var hv := Vector3(velocity.x, 0, velocity.z)
	var wish := dir * target_speed
	hv = hv.lerp(wish if moving else Vector3.ZERO, clamp(accel * delta, 0, 1))
	velocity.x = hv.x
	velocity.z = hv.z

	if is_on_floor():
		if Input.is_action_pressed("jump"):
			velocity.y = jump_force
	else:
		velocity.y -= gravity * delta

	move_and_slide()

	# crouch capsule height
	var target_h := crouch_height if crouching else stand_height
	_capsule.height = lerp(_capsule.height, target_h, clamp(delta * 12, 0, 1))
	head.position.y = lerp(head.position.y, target_h, clamp(delta * 12, 0, 1))

	_update_weapon(delta, moving)

func _update_weapon(delta: float, moving: bool) -> void:
	aiming = Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and not reloading

	# weapon switch
	if Input.is_action_just_pressed("weapon_1"): _equip(0)
	if Input.is_action_just_pressed("weapon_2"): _equip(1)
	if Input.is_action_just_pressed("weapon_3"): _equip(2)
	if Input.is_action_just_pressed("reload"): _start_reload()

	# reload timer
	if reloading:
		reload_timer -= delta
		if reload_timer <= 0.0:
			_finish_reload()

	# ADS fov
	var w = weapons[cur]
	var target_fov: float = w["ads_fov"] if aiming else (base_fov * (1.05 if sprinting else 1.0))
	camera.fov = lerp(camera.fov, target_fov, clamp(delta * 10, 0, 1))

	# fire
	fire_timer -= delta
	var lmb := Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	var want := lmb if w["auto"] else (lmb and not _left_was_down)
	_left_was_down = lmb
	if want and not reloading and fire_timer <= 0.0:
		if mag <= 0:
			_start_reload()
		else:
			fire_timer = 60.0 / w["rpm"]
			mag -= 1
			ammo[cur][0] = mag
			_fire(w)

	# recoil spring
	punch += punch_vel * delta
	punch_vel *= max(0.0, 1.0 - delta * 18.0)
	punch *= max(0.0, 1.0 - delta * 12.0)
	head.rotation.x = pitch + punch.x
	head.rotation.y = punch.y

	# viewmodel ADS/bob pose
	var rest := Vector3(0.18, -0.2, -0.5)
	var ads := Vector3(0.0, -0.093, -0.42)
	var pose := rest.lerp(ads, _ads_blend(delta))
	if moving and is_on_floor():
		bob_t += delta * (13.0 if sprinting else 9.0)
		pose += Vector3(cos(bob_t) * 0.012, abs(sin(bob_t)) * 0.012, 0) * (0.4 if aiming else 1.0)
	view_weapon.position = view_weapon.position.lerp(pose, clamp(delta * 14, 0, 1))
	_spread_bloom = max(0.0, _spread_bloom - delta * 2.2)

	# muzzle flash decay
	if flash_time > 0.0:
		flash_time -= delta
		var t := flash_time / 0.05
		muzzle_flash.light_energy = max(0.0, t * 5.0)
		flash_mesh.visible = true
	else:
		muzzle_flash.light_energy = 0.0
		flash_mesh.visible = false

var _adsb := 0.0
func _ads_blend(delta: float) -> float:
	_adsb = lerp(_adsb, 1.0 if aiming else 0.0, clamp(delta * 12, 0, 1))
	return _adsb

func _fire(w: Dictionary) -> void:
	flash_time = 0.05
	flash_mesh.rotation.z = randf() * TAU
	punch_vel.x += w["recoil"]
	punch_vel.y += randf_range(-1, 1) * w["recoil"] * 0.4
	_spread_bloom = min(1.0, _spread_bloom + 0.16)

	var spread: float = (w["ads_spread"] if aiming else w["spread"]) * (1.0 + _spread_bloom * 1.6)
	var from := camera.global_position
	var fdir := -camera.global_transform.basis.z
	fdir += camera.global_transform.basis.x * randf_range(-1, 1) * spread
	fdir += camera.global_transform.basis.y * randf_range(-1, 1) * spread
	fdir = fdir.normalized()
	var to := from + fdir * w["range"]

	var space := get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from, to)
	query.collision_mask = (1 << 0) | (1 << 2)  # world (layer1) + enemy (layer3)
	query.collide_with_areas = false
	var hit := space.intersect_ray(query)
	if hit.is_empty():
		return
	var collider = hit["collider"]
	if collider and collider.is_in_group("enemies") and collider.has_method("take_damage"):
		var headshot: bool = hit["position"].y > collider.global_position.y + 1.5
		var dmg: float = w["dmg"] * (w["hs"] if headshot else 1.0)
		collider.take_damage(dmg, headshot)
	else:
		_spawn_impact(hit["position"], hit.get("normal", Vector3.UP))

func _spawn_impact(pos: Vector3, normal: Vector3) -> void:
	var spark := OmniLight3D.new()
	spark.position = pos + normal * 0.1
	spark.light_color = Color(1.0, 0.75, 0.4)
	spark.light_energy = 2.0
	spark.omni_range = 2.5
	game.add_child(spark)
	var tw := create_tween()
	tw.tween_property(spark, "light_energy", 0.0, 0.12)
	tw.tween_callback(spark.queue_free)

func _equip(i: int) -> void:
	cur = i
	var w = weapons[i]
	weapon_name = w["name"]
	mag = ammo[i][0]
	reserve = ammo[i][1]
	reloading = false
	reload_timer = 0.0

func _start_reload() -> void:
	var w = weapons[cur]
	if reloading or mag >= w["mag"] or reserve <= 0:
		return
	reloading = true
	reload_timer = w["reload"]

func _finish_reload() -> void:
	var w = weapons[cur]
	var need: int = w["mag"] - mag
	var take: int = min(need, reserve)
	mag += take
	reserve -= take
	ammo[cur][0] = mag
	ammo[cur][1] = reserve
	reloading = false

func take_damage(amount: float) -> void:
	health = max(0.0, health - amount)
	if health <= 0.0:
		_die()

func heal(amount: float) -> void:
	health = min(max_health, health + amount)

func _die() -> void:
	if game and game.has_method("announce"):
		game.announce("YOU DIED", 999.0)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	set_physics_process(false)
