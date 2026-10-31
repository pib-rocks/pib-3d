"""Bring up the reduced pib model in RViz 2 (ROS 2).

    ros2 launch pib pib_control.launch.py

Publishes the control model, not the Onshape export: 46 links, 45 joints,
collision geometry on every link.
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    share = get_package_share_directory("pib")
    urdf_path = os.path.join(share, "urdf", "pib.control.urdf")
    with open(urdf_path, "r", encoding="utf-8") as handle:
        robot_description = handle.read()

    return LaunchDescription([
        Node(
            package="robot_state_publisher",
            executable="robot_state_publisher",
            output="screen",
            parameters=[{"robot_description": robot_description}],
        ),
        Node(
            package="joint_state_publisher_gui",
            executable="joint_state_publisher_gui",
            output="screen",
        ),
        Node(
            package="rviz2",
            executable="rviz2",
            output="screen",
        ),
    ])
