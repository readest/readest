/// This retain-balancing algorithm is cool but likely isn't required.
/// I'm keeping it around in case it's necessary one day.

// #[derive(Clone, Copy, Debug)]
// enum ValueArity {
//     Reference,
//     Value,
// }

// pub unsafe fn balance_ptrs(args: Vec<(*const c_void, bool)>, ret: Vec<(*const c_void, bool)>) {
//     fn collect_references(
//         v: Vec<(*const c_void, bool)>,
//     ) -> BTreeMap<*const c_void, Vec<ValueArity>> {
//         v.into_iter().fold(
//             BTreeMap::<_, Vec<ValueArity>>::new(),
//             |mut map, (ptr, is_ref)| {
//                 map.entry(ptr).or_default().push(if is_ref {
//                     ValueArity::Reference
//                 } else {
//                     ValueArity::Value
//                 });
//                 map
//             },
//         )
//     }

//     let mut args = collect_references(args);
//     let mut ret = collect_references(ret);

//     let both_counts = args
//         .clone()
//         .into_iter()
//         .flat_map(|(arg, values)| {
//             ret.remove(&arg).map(|ret| {
//                 args.remove(&arg);

//                 let ret_values = ret
//                     .iter()
//                     .filter(|v| matches!(v, ValueArity::Value))
//                     .count() as isize;

//                 let arg_references = values
//                     .iter()
//                     .filter(|v| matches!(v, ValueArity::Reference))
//                     .count() as isize;

//                 let ref_in_value_out_retains = min(ret_values, arg_references);

//                 (arg, ref_in_value_out_retains)
//             })
//         })
//         .collect::<Vec<_>>();

//     let arg_counts = args.into_iter().map(|(ptr, values)| {
//         let count = values
//             .into_iter()
//             .filter(|v| matches!(v, ValueArity::Value))
//             .count() as isize;
//         (ptr, count)
//     });

//     let ret_counts = ret
//         .into_iter()
//         .map(|(ptr, values)| {
//             let count = values
//                 .into_iter()
//                 .filter(|v| matches!(v, ValueArity::Value))
//                 .count() as isize;
//             (ptr, count)
//         })
//         .collect::<Vec<_>>();

//     both_counts
//         .into_iter()
//         .chain(arg_counts)
//         .chain(ret_counts)
//         .for_each(|(ptr, count)| match count {
//             0 => {}
//             n if n > 0 => {
//                 for _ in 0..n {
//                     retain_object(ptr)
//                 }
//             }
//             n => {
//                 for _ in n..0 {
//                     release_object(ptr)
//                 }
//             }
//         });
// }
