variable "openstack_user_name" { }
variable "openstack_password" { }
variable "keypair" { }
variable "staff_password" { }
variable "private_key_file" { }
variable "bastion_host" { }
variable "bastion_user" { }
variable "bastion_password" { }

variable "boot-image-uuid" {
  default = "7a0a850f-6ca5-4b16-947c-0781d18313ca" # CSAIL-Ubuntu-18.04LTS+autofs
}

# CSAIL's OpenStack provider.
provider "openstack" {
  tenant_name = "mario"
  user_name = var.openstack_user_name
  password  = var.openstack_password
  auth_url  = "https://keystone.csail.mit.edu:35358/"
}

# This is the virtual machine.
resource "openstack_compute_instance_v2" "gitstream" {
  name = "gitstream-new"
  flavor_name = "ups.2c2g"
  image_id = var.boot-image-uuid

  block_device {
    uuid                  = var.boot-image-uuid
    source_type           = "image"
    destination_type      = "local"
    boot_index            = 0
    delete_on_termination = true
  }

  network {
    name = "inet"
    #fixed_ip_v4 = "128.52.128.206"
  }

  # IMPORTANT: generate this keypair yourself with "ssh-keygen -t rsa",
  # then import it into OpenStack;
  # if instead you use the Create Keypair button in the OpenStack UI, it seems to
  # create a keypair that Terraform can't subsequently use for ssh provisioning 
  # (which needs to happen below).
  key_pair = var.keypair

  security_groups = [
    "allow ssh from mit only",
    "allow http and https"
  ]

}


# Provision the VM: upload application code, install necessary packages, configure, and
# launch the application.
#
# This provisioner is kept as a separate null resource, rather than
# being inlined in the instance resource, so that we can rerun it without
# having to recreate the instance.
#
#    terraform taint null_resource.provision
#
# will make terraform mark it dirty, so that it runs on the next terraform apply.
# The triggers map can also mark it dirty when certain files 
# change on disk (like setup.sh); this is commented out right now, but
# is useful for debugging.
#
resource "null_resource" "provision" {
  depends_on = [
    openstack_compute_instance_v2.gitstream
  ]

  connection {
      type     = "ssh"
      user     = "ubuntu"
      host     = openstack_compute_instance_v2.gitstream.access_ip_v4
      private_key = file(var.private_key_file)
      bastion_host = var.bastion_host
      bastion_user = var.bastion_user
      bastion_password = var.bastion_password
  }

}