variable "openstack_user_name" { }
variable "openstack_password" { }
variable "keypair" { }
variable "staff_password" { }
variable "private_key_file" { }

# only uncomment if using CSAIL's jump server, see below
#variable "bastion_user" { }
#variable "bastion_password" { }

variable "boot-image-uuid" {
  default = "ef794b7d-4a30-4e28-8230-e599de4d9b19" # CSAIL-Ubuntu-20.04LTS 12-Nov-2020
}

# CSAIL's OpenStack provider.
provider "openstack" {
  tenant_name = "mario"
  user_name = var.openstack_user_name
  password  = var.openstack_password
  auth_url  = "https://keystone.csail.mit.edu:35358/"
}

# This is the volume where persistent data is stored
# (e.g. the Let's Encrypt folder).
# It's mounted at /mnt/persistent in the running VM,
# and symlinked to from various places on the VM filesystem.
resource "openstack_blockstorage_volume_v1" "gitstream-persistent" {
  name     = "gitstream-persistent"
  size     = 1 # GB
}

# This is the virtual machine.
resource "openstack_compute_instance_v2" "gitstream" {
  name = "gitstream"
  flavor_name = "ups.2c2g"
  image_id = var.boot-image-uuid

  block_device {
    uuid                  = var.boot-image-uuid
    source_type           = "image"
    destination_type      = "local"
    boot_index            = 0
    delete_on_termination = true
  }

  block_device {
    uuid = openstack_blockstorage_volume_v1.gitstream-persistent.id
    source_type = "volume"
    destination_type = "volume"
    boot_index = 1
  }


  network {
    name = "inet"
    fixed_ip_v4 = "128.52.128.68"
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
  triggers = {
    instance_changed = openstack_compute_instance_v2.gitstream.id
  }
  
  # IMPORTANT: the security setup above allows incoming ssh only from MIT network addresses.
  # So you can't run this provisioning unless you're on the MIT network.
  # When you're offcampus, use the MIT VPN (https://ist.mit.edu/vpn).
  # If MIT VPN is impossible, can also use CSAIL's jump server:
  #   1. uncomment the "variable" sections for bastion_username and bastion_password at the top of this file
  #   2. uncomment the bastion_... lines below
  #   3. define bastion_user and bastion_password with your CSAIL username/password in terraform.tfvars
  connection {
      type     = "ssh"
      user     = "ubuntu"
      host     = openstack_compute_instance_v2.gitstream.access_ip_v4
      private_key = file(var.private_key_file)

      #bastion_host = "jump.csail.mit.edu"
      #bastion_user = var.bastion_user
      #bastion_password = var.bastion_password
  }

  # upload the application code
  provisioner "local-exec" {
    # COPYFILE_DISABLE is for MacOS, prevents resource forks (._blahblah) from appearing in the tarball
    command = "COPYFILE_DISABLE=1 tar czf ./deployed-bundle.tgz --exclude=terraform --exclude=.DS_Store --exclude=.vagrant --exclude='node_modules' --exclude='dist' -C .. ."
  }

  provisioner "file" {
    source = "deployed-bundle.tgz"
    destination = "/home/ubuntu/deployed-bundle.tgz"
  }

  provisioner "remote-exec" {
    inline = [
      "echo '${var.staff_password}\n${var.staff_password}' | sudo /usr/bin/passwd ubuntu",
      "mkdir -p $HOME/gitstream",
      "cd $HOME/gitstream",
      "tar xzf $HOME/deployed-bundle.tgz",
      "ln -sf settings-deployed.js settings.js",
      "./setup.sh",
    ]
  }
}
