import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/context/AuthContext';
import { useTheme } from '../src/context/ThemeContext';
import { safeBack } from '../src/utils/navigation';

const value = (v) => v || 'Not available';
const date = (v) => v ? new Date(v).toLocaleDateString() : 'Not available';

export default function ContractViewer() {
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const contract = user?.contract;
  const branch = user?.branch;
  const rows = contract ? [
    ['Contract Status', value(contract.status)], ['Room Number', value(contract.roomNumber)],
    ['Branch Name', value(branch?.branchName)], ['Branch Address', value(branch?.branchAddress)], ['Lease Type', value(contract.leaseType)],
    ['Start Date', date(contract.startDate)], ['End Date', date(contract.endDate)],
    ['Document Version', value(contract.documentVersion || contract.version)], ['Generated Date', date(contract.generatedDate || contract.createdAt)],
  ] : [];
  return <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}><TouchableOpacity onPress={() => safeBack(router)}><Ionicons name="arrow-back" size={25} color={colors.text}/></TouchableOpacity><Text style={[styles.title,{color:colors.text}]}>Lease Contract</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      {!contract ? <View style={styles.empty}><Ionicons name="document-outline" size={58} color={colors.textSecondary}/><Text style={[styles.emptyTitle,{color:colors.text}]}>No contract available yet.</Text><Text style={{color:colors.textSecondary,textAlign:'center'}}>Your lease contract is not yet available.</Text></View>
      : <><View style={[styles.card,{backgroundColor:colors.card}]}>{rows.map(([label,val])=><View key={label} style={[styles.row,{borderBottomColor:colors.border}]}><Text style={{color:colors.textSecondary}}>{label}</Text><Text style={[styles.val,{color:colors.text}]}>{val}</Text></View>)}</View>
      <TouchableOpacity style={[styles.open,{backgroundColor:colors.primary}]} onPress={()=>router.push({pathname:'/document-viewer',params:{kind:'user',id:contract.documentId,title:'Lease Contract'}})}><Ionicons name="document-text-outline" size={20} color="#fff"/><Text style={styles.openText}>Open contract PDF</Text></TouchableOpacity></>}
    </ScrollView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1},header:{height:62,borderBottomWidth:1,flexDirection:'row',alignItems:'center',gap:16,paddingHorizontal:16},title:{fontSize:18,fontWeight:'700'},content:{padding:18},empty:{alignItems:'center',paddingTop:100,gap:12},emptyTitle:{fontSize:19,fontWeight:'700'},card:{borderRadius:14,paddingHorizontal:16},row:{paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth},val:{fontWeight:'700',marginTop:4},open:{marginTop:20,borderRadius:12,padding:15,flexDirection:'row',justifyContent:'center',gap:9},openText:{color:'#fff',fontWeight:'700'}});
