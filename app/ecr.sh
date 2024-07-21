export ECR_REPO=730335309881.dkr.ecr.us-east-2.amazonaws.com/snitch
aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin $ECR_REPO
docker build -t snitch .
docker tag snitch:latest $ECR_REPO:latest
docker push $ECR_REPO:latest