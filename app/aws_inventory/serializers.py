from rest_framework import serializers  
from .models import AwsAccount, AwsCloudtrailTrailEvent  
  
class AwsAccountSerializer(serializers.ModelSerializer):  
    arn = serializers.CharField(max_length=200, required=True)  
    organization_id = serializers.CharField(max_length=200, required=True)  
    title = serializers.CharField(max_length=10, required=True)  
  
    class Meta:  
        model = AwsAccount  
        fields = ('__all__')  

class AwsCloudtrailTrailEventSerializer(serializers.ModelSerializer):
   
    class Meta:  
        model = AwsCloudtrailTrailEvent  
        fields = ('__all__')  