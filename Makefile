PY ?= python3

.PHONY: help verify reproduce assets tree serve check-meshes all clean

help:
	@echo "make verify        control model vs. Onshape export (numpy only)"
	@echo "make reproduce     fail if urdf/pib.control.urdf is not what the script produces"
	@echo "make check-meshes  every mesh referenced by the URDFs exists, none unused"
	@echo "make assets        bake web/meshes/<link>.glb (needs trimesh, ~60 s)"
	@echo "make tree          redraw docs/pib.control.tree.png (needs matplotlib)"
	@echo "make serve         static viewer on http://localhost:8099/"
	@echo "make all           verify + reproduce + check-meshes"

verify:
	$(PY) tools/urdf_verify.py

reproduce:
	$(PY) tools/urdf_reduce.py --out /tmp/pib.control.urdf
	cmp /tmp/pib.control.urdf urdf/pib.control.urdf

check-meshes:
	$(PY) tools/check_meshes.py

assets:
	$(PY) tools/build_web_assets.py

tree:
	$(PY) tools/urdf_tree.py

serve:
	$(PY) tools/serve_web.py 8099

all: verify reproduce check-meshes

clean:
	rm -rf web/meshes
