import json
import time

from common.constants import *
from common.utils import *
from common.utilsgui import *
from common.models import *

def render(dp, fields, vld):
	"""Render the treemap visualization view."""

	# Parse configuration parameters from fields
	config = parse_treemap_config(fields)

	# Get treemap data from data provider
	treemap_data = dp.get_treemap_data(
		path=config.path,
		depth=config.depth,
		color_by=config.color_by
	)

	# Generate HTML output
	out = []
	out.append('<div class="tab_title no_table">')
	out.append('<svg class="icon" height="20px" width="20px"><use xlink:href="#icon-chart"/></svg>')
	out.append('Filesystem Treemap')
	out.append('</div>')

	# Add configuration controls
	out.extend(render_treemap_controls(config))

	# Add treemap visualization container
	out.extend(render_treemap_container(treemap_data, config))

	# Add statistics panel
	out.extend(render_treemap_stats(treemap_data))

	# Add JavaScript initialization
	out.extend(render_treemap_script(treemap_data, config))

	return out

def parse_treemap_config(fields):
	"""Parse treemap configuration from form fields."""
	config = TreemapConfig()

	# Parse path
	if 'path' in fields:
		val = fields.getvalue('path')
		if val:
			config.path = val

	# Parse depth
	if 'depth' in fields:
		val = fields.getvalue('depth')
		if val:
			try:
				config.depth = int(val)
				config.depth = max(1, min(10, config.depth))  # Clamp between 1-10
			except ValueError:
				config.depth = 3

	# Parse color scheme
	if 'color_by' in fields:
		val = fields.getvalue('color_by')
		if val and val in ['type', 'age', 'size']:
			config.color_by = val

	# Parse include files
	if 'include_files' in fields:
		val = fields.getvalue('include_files')
		config.include_files = (val == '1')

	return config

def render_treemap_controls(config):
	"""Render treemap configuration controls."""
	out = []
	out.append('<div class="treemap-controls">')

	# Path input
	out.append('<div class="treemap-control-group">')
	out.append('<label for="treemap-path">Path:</label>')
	out.append('<input type="text" id="treemap-path" class="treemap-path-input" ')
	out.append('value="%s" placeholder="Enter filesystem path">' % html_escape(config.path))
	out.append('</div>')

	# Depth selector
	out.append('<div class="treemap-control-group">')
	out.append('<label for="treemap-depth">Depth:</label>')
	out.append('<select id="treemap-depth" class="treemap-depth-selector">')
	for depth in range(1, 6):  # Limit to 5 levels for better performance
		selected = 'selected' if depth == config.depth else ''
		out.append('<option value="%d" %s>%d</option>' % (depth, selected, depth))
	out.append('</select>')
	out.append('</div>')

	# Color scheme selector
	out.append('<div class="treemap-control-group">')
	out.append('<label for="treemap-color-scheme">Color:</label>')
	out.append('<select id="treemap-color-scheme" class="select-fl">')
	color_options = [
		('type', 'File Type'),
		('age', 'File Age'),
		('size', 'File Size')
	]
	for value, label in color_options:
		selected = 'selected' if value == config.color_by else ''
		out.append('<option value="%s" %s>%s</option>' % (value, selected, label))
	out.append('</select>')
	out.append('</div>')

	# Include files checkbox
	out.append('<div class="treemap-control-group">')
	out.append('<label>')
	checked = 'checked' if config.include_files else ''
	out.append('<input type="checkbox" id="treemap-include-files" %s>' % checked)
	out.append('Include Files')
	out.append('</label>')
	out.append('</div>')

	# Refresh button
	out.append('<div class="treemap-control-group">')
	out.append('<button id="treemap-refresh" class="pointer">Refresh</button>')
	out.append('</div>')

	out.append('</div><!-- treemap-controls -->')

	return out

def render_treemap_container(treemap_data, config):
	"""Render the main treemap visualization container."""
	out = []

	if 'error' in treemap_data:
		# Show error message
		out.append('<div class="treemap-error">')
		out.append(html_escape(treemap_data['error']))
		out.append('</div>')
	else:
		# Breadcrumb navigation
		out.append('<div class="treemap-breadcrumb" id="treemap-breadcrumb">')
		out.extend(render_breadcrumb_navigation(treemap_data))
		out.append('</div>')

		# Treemap container
		out.append('<div class="treemap-container" style="width:100%;">')
		out.append('<div id="treemap-visualization" style="width:100%; min-height:600px;" ')
		out.append('data-treemap="true" ')
		out.append('data-color-scheme="%s" ' % config.color_by)
		out.append('data-include-files="%s" ' % ('true' if config.include_files else 'false'))
		out.append('data-max-depth="%s">' % config.depth)
		out.append('</div>')
		out.append('</div>')

	return out

def render_breadcrumb_navigation(treemap_data):
	"""Render breadcrumb navigation for current path."""
	out = []

	path = treemap_data.get('name', '/')
	if path == '/':
		out.append('<a href="#" class="treemap-breadcrumb-item" data-path="/">/</a>')
	else:
		# Split path and create breadcrumb items
		parts = path.strip('/').split('/')
		out.append('<a href="#" class="treemap-breadcrumb-item" data-path="/">/</a>')

		current_path = ''
		for part in parts:
			current_path += '/' + part
			out.append('<span class="treemap-breadcrumb-separator">›</span>')
			if current_path == path:
				out.append('<span class="treemap-breadcrumb-current">%s</span>' % html_escape(part))
			else:
				out.append('<a href="#" class="treemap-breadcrumb-item" data-path="%s">%s</a>' %
					(html_escape(current_path), html_escape(part)))

	return out

def render_treemap_stats(treemap_data):
	"""Render treemap statistics panel."""
	out = []

	if 'error' not in treemap_data:
		out.append('<div class="treemap-stats">')

		# Total size
		total_size = treemap_data.get('total_size', 0)
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">%s</div>' % format_bytes(total_size))
		out.append('<div class="treemap-stat-label">Total Size</div>')
		out.append('</div>')

		# File count
		total_files = treemap_data.get('total_files', 0)
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">%s</div>' % format_number(total_files))
		out.append('<div class="treemap-stat-label">Files</div>')
		out.append('</div>')

		# Directory count
		total_dirs = treemap_data.get('total_dirs', 0)
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">%s</div>' % format_number(total_dirs))
		out.append('<div class="treemap-stat-label">Directories</div>')
		out.append('</div>')

		# Max depth
		out.append('<div class="treemap-stat-item">')
		out.append('<div class="treemap-stat-value">3</div>')
		out.append('<div class="treemap-stat-label">Max Depth</div>')
		out.append('</div>')

		out.append('</div><!-- treemap-stats -->')

		# Add color legend
		out.append('<div class="treemap-legend" id="treemap-legend">')
		out.append('</div>')

	return out

def render_treemap_script(treemap_data, config):
	"""Embed treemap data as JSON script tag (consumed by treemap.js auto-init)."""
	out = []
	out.append('<script type="application/json" id="treemap-initial-data">')
	out.append(json.dumps(treemap_data))
	out.append('</script>')
	return out

def format_bytes(bytes_value):
	"""Format bytes in human-readable format."""
	if bytes_value == 0:
		return '0 B'

	units = ['B', 'KB', 'MB', 'GB', 'TB']
	unit_index = 0
	size = float(bytes_value)

	while size >= 1024.0 and unit_index < len(units) - 1:
		size /= 1024.0
		unit_index += 1

	if unit_index == 0:
		return '%d %s' % (int(size), units[unit_index])
	else:
		return '%.1f %s' % (size, units[unit_index])

def format_number(number):
	"""Format number with thousands separator."""
	if number == 0:
		return '0'
	return '{:,}'.format(number)

def html_escape(text):
	"""Escape HTML special characters."""
	if text is None:
		return ''
	return (str(text)
		.replace('&', '&amp;')
		.replace('<', '&lt;')
		.replace('>', '&gt;')
		.replace('"', '&quot;')
		.replace("'", '&#x27;'))