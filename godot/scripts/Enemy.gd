extends CharacterBody3D
## Hostile soldier: procedurally modelled from boxes, chases and strafes the
## player, fires with a line-of-sight check, takes located damage (headshots),
## and topples on death. Its capsule sits on collision layer 3 so the player's
## hitscan ray can hit it.

var game: Node3D
var target: Node3D
var max_health := 100.0
var health := 100.0
var damage := 8.0
var speed := 3.6
var accuracy := 0.6
var fire_cd := 0.0
var fire_rate := 0.9
var strafe_dir := 1.0
var strafe_t := 0.0
var anim_t := 0.0
var gravity := 20.0
var dying := false

var leg_l: MeshInstance3D
var leg_r: MeshInstance3D
var hp_bar: MeshInstance3D

func _ready() -> void:
	health = max_health
	var col := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.4
	cap.height = 1.7
	col.shape = cap
	col.position = Vector3(0, 0.9, 0)
	add_child(col)
	_build_model()

func _mat(color: Color, rough := 0.8, metal := 0.05) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	return m

func _part(size: Vector3, pos: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = size
	mi.mesh = box
	mi.material_override = mat
	mi.position = pos
	add_child(mi)
	return mi

func _build_model() -> void:
	var fatigue := _mat(Color(0.28, 0.26, 0.18))
	var gear := _mat(Color(0.11, 0.12, 0.14), 0.7, 0.15)
	var skin := _mat(Color(0.54, 0.35, 0.24), 0.7)
	var vest := _mat(Color(0.16, 0.18, 0.13), 0.6, 0.2)

	_part(Vector3(0.5, 0.7, 0.28), Vector3(0, 1.15, 0), fatigue)   # torso
	_part(Vector3(0.54, 0.5, 0.32), Vector3(0, 1.22, 0), vest)     # vest
	_part(Vector3(0.44, 0.3, 0.26), Vector3(0, 0.78, 0), gear)     # pelvis
	_part(Vector3(0.26, 0.28, 0.26), Vector3(0, 1.68, 0), skin)    # head
	var helmet := _part(Vector3(0.3, 0.16, 0.3), Vector3(0, 1.8, 0), gear)
	helmet.mesh.size = Vector3(0.3, 0.16, 0.3)
	_part(Vector3(0.13, 0.55, 0.13), Vector3(-0.33, 1.2, 0.05), fatigue)  # arm L
	_part(Vector3(0.13, 0.55, 0.13), Vector3(0.33, 1.2, 0.05), fatigue)   # arm R
	leg_l = _part(Vector3(0.16, 0.72, 0.18), Vector3(-0.13, 0.4, 0), gear)
	leg_r = _part(Vector3(0.16, 0.72, 0.18), Vector3(0.13, 0.4, 0), gear)
	_part(Vector3(0.06, 0.1, 0.5), Vector3(0.2, 1.3, -0.25), _mat(Color(0.06, 0.07, 0.09), 0.5, 0.4))  # rifle

	# health bar (billboarded quad that scales with HP)
	hp_bar = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 0.12)
	hp_bar.mesh = q
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color(0.2, 0.88, 0.75)
	hm.emission_enabled = true
	hm.emission = Color(0.2, 0.88, 0.75)
	hm.emission_energy_multiplier = 1.5
	hm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	hm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	hm.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
	hp_bar.mesh.material = hm
	hp_bar.position = Vector3(0, 2.05, 0)
	add_child(hp_bar)

func _physics_process(delta: float) -> void:
	if dying:
		velocity.y -= gravity * delta
		move_and_slide()
		return
	if not is_instance_valid(target):
		return

	var to_player := target.global_position - global_position
	to_player.y = 0
	var dist := to_player.length()
	to_player = to_player.normalized()

	# face the player
	var yaw := atan2(to_player.x, to_player.z)
	rotation.y = lerp_angle(rotation.y, yaw, clamp(delta * 6, 0, 1))

	var desired := Vector3.ZERO
	var has_los := _line_of_sight()
	if dist > 22.0 or not has_los:
		desired = to_player * speed          # close in
	else:
		# strafe + hold distance, and shoot
		strafe_t -= delta
		if strafe_t <= 0.0:
			strafe_dir *= -1.0
			strafe_t = randf_range(1.0, 2.5)
		var right := Vector3(to_player.z, 0, -to_player.x)
		desired = right * strafe_dir * speed * 0.7
		if dist < 14.0:
			desired -= to_player * speed * 0.4
		fire_cd -= delta
		if fire_cd <= 0.0 and has_los:
			fire_cd = fire_rate
			_shoot()

	velocity.x = lerp(velocity.x, desired.x, clamp(delta * 6, 0, 1))
	velocity.z = lerp(velocity.z, desired.z, clamp(delta * 6, 0, 1))
	if not is_on_floor():
		velocity.y -= gravity * delta
	else:
		velocity.y = 0.0
	move_and_slide()

	# walk animation
	anim_t += delta * velocity.length() * 2.2
	var swing := sin(anim_t) * clamp(velocity.length() / speed, 0, 1)
	leg_l.rotation.x = swing * 0.8
	leg_r.rotation.x = -swing * 0.8

func _line_of_sight() -> bool:
	if not is_instance_valid(target):
		return false
	var from := global_position + Vector3(0, 1.5, 0)
	var to: Vector3 = target.global_position + Vector3(0, 1.2, 0)
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, to)
	q.collision_mask = 1 << 0   # world only
	q.exclude = [self]
	var hit := space.intersect_ray(q)
	return hit.is_empty()

func _shoot() -> void:
	if not is_instance_valid(target):
		return
	var dist := global_position.distance_to(target.global_position)
	var chance: float = accuracy * clamp(1.0 - dist / 60.0, 0.15, 1.0)
	if randf() < chance and target.has_method("take_damage"):
		target.take_damage(damage)

func take_damage(amount: float, headshot: bool) -> void:
	if dying:
		return
	health -= amount
	var t := clamp(health / max_health, 0, 1)
	hp_bar.scale.x = max(0.02, t)
	var hm := hp_bar.mesh.material as StandardMaterial3D
	hm.albedo_color = Color(0.2, 0.88, 0.75) if t > 0.5 else (Color(1, 0.69, 0.13) if t > 0.25 else Color(1, 0.23, 0.3))
	hm.emission = hm.albedo_color
	if health <= 0.0:
		_die(headshot)

func _die(headshot: bool) -> void:
	dying = true
	hp_bar.visible = false
	collision_layer = 0
	if game and game.has_method("on_enemy_died"):
		game.on_enemy_died(self, headshot)
	# topple over, then remove
	var tw := create_tween()
	tw.tween_property(self, "rotation:x", -PI / 2, 0.6)
	tw.parallel().tween_property(self, "scale", Vector3.ONE * 0.98, 0.6)
	tw.tween_interval(4.0)
	tw.tween_callback(queue_free)
